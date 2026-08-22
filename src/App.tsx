import { useState, useEffect, useRef } from "react"
import LiveMapPage, { LiveMapCanvas } from "./map/MapPage"
import {
  fetchDashboardData,
  dismissAlertApi,
  setRouteWatchedApi,
  applyRerouteApi,
  dismissRerouteApi,
  generateReroutesApi,
  adaptReroute,
  notifyTeamApi,
  BACKEND_URL,
} from "./services/project44"
// ─── Types ────────────────────────────────────────────────────────────────────

type Severity = "critical" | "high" | "medium" | "low"
type NavPage = "dashboard" | "map" | "planner" | "alerts" | "analytics" | "settings"

type AlertEvent = {
  id: number
  time: string
  type: string
  location: string
  route: string
  severity: Severity
  summary: string
  ageMin: number
  dismissed?: boolean
}

type Route = {
  id: string
  from: string
  to: string
  via: string
  risk: Severity
  score: number
  status: string
  freight: string
  delay: string
  watched: boolean
}

type Reroute = {
  id: number
  original: string
  alt: string
  via: string
  extraDays: number
  extraCost: string
  confidence: number
  reason: string
  applied?: boolean
  dismissed?: boolean
}

type MLScore = {
  score: number
  confidence: number
  features: { severity: number; age: number; overlap: number; chokepoint: number; freight: number }
}

// ─── Data ─────────────────────────────────────────────────────────────────────

const STATS = [
  { label: "India trade by sea", value: "95%", delta: null, sub: "of total volume" },
  { label: "Freight spike (Red Sea)", value: "8×", delta: "+680%", sub: "vs pre-crisis avg" },
  { label: "Exports affected Aug '24", value: "−9.3%", delta: "−9.3%", sub: "YoY contraction" },
  { label: "Logistics cost / GDP", value: "7.97%", delta: null, sub: "down from 13% (2015)" },
]

const SEV_COLOR: Record<Severity, string> = {
  critical: "#ef4444",
  high: "#f59e0b",
  medium: "#f97316",
  low: "#22c55e",
}
const SEV_BG: Record<Severity, string> = {
  critical: "rgba(239,68,68,0.10)",
  high: "rgba(245,158,11,0.10)",
  medium: "rgba(249,115,22,0.10)",
  low: "rgba(34,197,94,0.08)",
}

function fmtAge(min: number) {
  if (min < 60) return `${min}m ago`
  return `${Math.floor(min / 60)}h ${min % 60}m ago`
}

// ─── ML Engine ────────────────────────────────────────────────────────────────

const SEV_WEIGHT: Record<Severity, number> = { critical: 1.0, high: 0.75, medium: 0.5, low: 0.25 }

const CHOKEPOINT_RISK: Record<string, number> = {
  "Red Sea": 1.0,
  "Suez Canal": 0.85,
  "Colombo, Sri Lanka": 0.70,
  "Malacca Strait": 0.60,
  "Panama Canal": 0.55,
  "Cape of Good Hope": 0.18,
}

function sigmoid(x: number) {
  return 1 / (1 + Math.exp(-x))
}

function computeRiskScore(alert: AlertEvent, routes: Route[]): MLScore {
  const sev = SEV_WEIGHT[alert.severity]
  // Recency feature: events < 2h score highest, decay over 10h
  const ageFactor = Math.max(0, 1 - alert.ageMin / 600)
  // Route overlap: how many routes share endpoints with this alert
  const parts = alert.route.split(" → ")
  const from = parts[0] ?? ""
  const to = parts[1] ?? ""
  const overlapCount = routes.filter(r => r.from === from || r.to === to || r.via === alert.location).length
  const overlap = overlapCount / Math.max(routes.length, 1)
  const choke = CHOKEPOINT_RISK[alert.location] ?? 0.30
  const freight = sev * (choke * 0.9 + 0.1)

  // Weighted sum → sigmoid squash to 0–100
  const raw = 0.35 * sev + 0.20 * ageFactor + 0.18 * overlap + 0.17 * choke + 0.10 * freight
  const score = Math.round(sigmoid(raw * 5.2 - 2.1) * 100)
  const confidence = Math.min(Math.round(62 + sev * 24 + ageFactor * 9 + choke * 5), 97)

  return {
    score,
    confidence,
    features: {
      severity: Math.round(sev * 100) / 100,
      age: Math.round(ageFactor * 100) / 100,
      overlap: Math.round(overlap * 100) / 100,
      chokepoint: Math.round(choke * 100) / 100,
      freight: Math.round(freight * 100) / 100,
    },
  }
}

function zScoreAnomalies(series: number[]): number[] {
  const n = series.length
  if (n < 2) return series.map(() => 0)
  const mean = series.reduce((a, b) => a + b, 0) / n
  const std = Math.sqrt(series.map(x => (x - mean) ** 2).reduce((a, b) => a + b, 0) / n)
  return series.map(x => Math.abs((x - mean) / (std || 1)))
}

function linearRegression(xs: number[], ys: number[]) {
  const n = xs.length
  const sx = xs.reduce((a, b) => a + b, 0)
  const sy = ys.reduce((a, b) => a + b, 0)
  const sxy = xs.reduce((a, xi, i) => a + xi * ys[i], 0)
  const sx2 = xs.reduce((a, xi) => a + xi * xi, 0)
  const denom = n * sx2 - sx * sx
  const slope = denom !== 0 ? (n * sxy - sx * sy) / denom : 0
  const intercept = (sy - slope * sx) / n
  const yMean = sy / n
  const ssTot = ys.reduce((a, yi) => a + (yi - yMean) ** 2, 0)
  const ssRes = ys.reduce((a, yi, i) => a + (yi - (slope * xs[i] + intercept)) ** 2, 0)
  return { slope, intercept, r2: ssTot > 0 ? 1 - ssRes / ssTot : 1 }
}

// Calls the backend's /ai/risk-analysis endpoint, which runs the Gemini
// call server-side. The API key never touches the browser bundle.
async function callRiskAnalysis(payload: {
  alerts: { severity: string; type: string; location: string; summary: string }[]
  top_location?: string
  top_score?: number
  top_confidence?: number
}): Promise<string> {
  const res = await fetch(`${BACKEND_URL}/ai/risk-analysis`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as any)?.detail ?? `HTTP ${res.status}`)
  }
  const data = await res.json()
  return (data.text as string) ?? "No response."
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function LiveDot() {
  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center", width: 10, height: 10 }}>
      <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "#22c55e", animation: "pulse-ring 1.8s ease-out infinite" }} />
      <span style={{ position: "relative", width: 7, height: 7, borderRadius: "50%", background: "#22c55e", display: "block" }} />
    </span>
  )
}

function SeverityBadge({ sev }: { sev: Severity }) {
  return (
    <span
      className="mono"
      style={{
        fontSize: 9,
        fontWeight: 500,
        letterSpacing: "0.08em",
        padding: "2px 6px",
        borderRadius: 3,
        background: SEV_BG[sev],
        color: SEV_COLOR[sev],
        border: `1px solid ${SEV_COLOR[sev]}30`,
        whiteSpace: "nowrap",
      }}
    >
      {sev.toUpperCase()}
    </span>
  )
}

function RiskBar({ score, sev }: { score: number; sev: Severity }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ flex: 1, height: 3, background: "#1a2d42", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: `${score}%`, height: "100%", background: SEV_COLOR[sev], borderRadius: 2, transition: "width 0.4s ease" }} />
      </div>
      <span className="mono" style={{ fontSize: 10, color: SEV_COLOR[sev], minWidth: 24, textAlign: "right" }}>
        {score}
      </span>
    </div>
  )
}

function ShimmerBar() {
  return (
    <div style={{ height: 3, borderRadius: 2, overflow: "hidden", background: "#1a2d42" }}>
      <div
        style={{
          width: "55%",
          height: "100%",
          background: "linear-gradient(90deg, #1a2d42 0%, #243447 50%, #1a2d42 100%)",
          backgroundSize: "200% 100%",
          animation: "shimmer 1.4s ease infinite",
          borderRadius: 2,
        }}
      />
    </div>
  )
}

function Btn({
  children,
  onClick,
  small,
  danger,
}: {
  children: React.ReactNode
  onClick?: () => void
  small?: boolean
  danger?: boolean
}) {
  const [hover, setHover] = useState(false)
  const bg = danger ? (hover ? "#ef4444" : "rgba(239,68,68,0.12)") : hover ? "var(--primary)" : "var(--primary-dim)"
  const col = danger ? (hover ? "#fff" : "#ef4444") : hover ? "#000" : "var(--primary)"
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: small ? "3px 8px" : "5px 12px",
        fontSize: small ? 9 : 10,
        fontFamily: "DM Mono, monospace",
        fontWeight: 600,
        letterSpacing: "0.06em",
        background: bg,
        color: col,
        border: `1px solid ${danger ? "#ef444440" : "var(--primary)40"}`,
        borderRadius: 4,
        cursor: "pointer",
        transition: "all 0.15s",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  )
}

function FeatureChart({ features }: { features: MLScore["features"] }) {
  const items = [
    { key: "severity", label: "SEV", val: features.severity },
    { key: "chokepoint", label: "CHOKE", val: features.chokepoint },
    { key: "overlap", label: "OVERLAP", val: features.overlap },
    { key: "age", label: "RECENCY", val: features.age },
    { key: "freight", label: "FREIGHT", val: features.freight },
  ]
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
      {items.map(item => (
        <div key={item.key} style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span className="mono" style={{ fontSize: 7, color: "var(--text-3)", width: 42, textAlign: "right" }}>
            {item.label}
          </span>
          <div style={{ flex: 1, height: 2, background: "#1a2d42", borderRadius: 1, overflow: "hidden" }}>
            <div
              style={{
                width: `${item.val * 100}%`,
                height: "100%",
                background: "var(--primary)",
                opacity: 0.65,
                borderRadius: 1,
                transition: "width 0.5s ease",
              }}
            />
          </div>
          <span className="mono" style={{ fontSize: 7, color: "var(--text-3)", width: 26 }}>
            {(item.val * 100).toFixed(0)}%
          </span>
        </div>
      ))}
    </div>
  )
}

// ─── World Map SVG ─────────────────────────────────────────────────────────────

function WorldMap({
  activeAlert,
  mlScores,
  fullscreen,
}: {
  activeAlert: number | null
  mlScores?: Record<number, MLScore>
  fullscreen?: boolean
}) {
  const hotspots = [
    { id: 1, cx: 310, cy: 178, label: "Red Sea / Bab-el-Mandeb", sev: "critical" as Severity },
    { id: 4, cx: 318, cy: 160, label: "Suez Canal", sev: "high" as Severity },
    { id: 2, cx: 530, cy: 230, label: "Malacca Strait", sev: "medium" as Severity },
    { id: 3, cx: 470, cy: 230, label: "Colombo", sev: "high" as Severity },
    { id: 5, cx: 168, cy: 218, label: "Panama Canal", sev: "medium" as Severity },
    { id: 6, cx: 258, cy: 310, label: "Cape of Good Hope", sev: "low" as Severity },
  ]
  const ports = [
    { cx: 448, cy: 192, label: "JNPT" },
    { cx: 452, cy: 196, label: "MND" },
    { cx: 463, cy: 211, label: "CHN" },
    { cx: 440, cy: 206, label: "COK" },
    { cx: 478, cy: 180, label: "KOL" },
  ]

  return (
    <svg
      viewBox="0 0 800 400"
      preserveAspectRatio="none"
      style={{
        width: "100%",
        height: "100%",
        display: "block",
      }}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <radialGradient id="h-critical" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ef4444" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#ef4444" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="h-high" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="h-medium" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#f97316" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#f97316" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="h-low" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#22c55e" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect width="800" height="400" fill="#07111e" />

      {/* Continents */}
      <path d="M240,60 L320,55 L340,80 L330,110 L310,120 L280,115 L250,100 L230,80 Z" fill="#0e1e30" stroke="#1a2e48" strokeWidth="0.5" />
      <path d="M260,115 L310,120 L340,140 L355,180 L350,240 L330,290 L295,310 L265,295 L245,260 L240,210 L248,160 Z" fill="#0e1e30" stroke="#1a2e48" strokeWidth="0.5" />
      <path d="M340,60 L500,50 L560,70 L590,100 L570,140 L530,160 L500,170 L460,160 L420,155 L390,140 L350,120 L330,110 L340,80 Z" fill="#0e1e30" stroke="#1a2e48" strokeWidth="0.5" />
      <path d="M420,155 L460,160 L480,175 L475,215 L455,235 L435,220 L425,195 L418,170 Z" fill="#0e1e30" stroke="#1a2e48" strokeWidth="0.5" />
      <path d="M530,160 L570,155 L590,170 L580,195 L550,205 L530,195 L520,180 Z" fill="#0e1e30" stroke="#1a2e48" strokeWidth="0.5" />
      <path d="M60,70 L170,65 L190,100 L185,160 L170,220 L150,270 L140,320 L120,320 L100,280 L85,220 L70,160 L55,110 Z" fill="#0e1e30" stroke="#1a2e48" strokeWidth="0.5" />
      <path d="M590,240 L660,235 L680,265 L670,300 L640,315 L605,305 L585,278 Z" fill="#0e1e30" stroke="#1a2e48" strokeWidth="0.5" />

      {/* Trade routes */}
      <path
        d="M448,192 Q420,200 380,188 Q350,178 318,165 Q300,155 290,148 Q272,130 265,120 Q258,110 250,100 Q244,90 240,85 Q255,82 270,80"
        fill="none"
        stroke={activeAlert === 1 || activeAlert === 4 ? "#ef4444" : "#00d4ff"}
        strokeWidth={activeAlert === 1 || activeAlert === 4 ? "3" : "2"}
        strokeDasharray={activeAlert === 1 || activeAlert === 4 ? "0" : "4,3"}
        opacity="0.7"
      />
      <path
        d="M448,192 Q445,220 442,240 Q438,270 400,295 Q360,310 310,305 Q275,302 258,306 Q250,295 245,270 Q240,240 240,200"
        fill="none"
        stroke="#22c55e"
        strokeWidth="1"
        strokeDasharray="5,4"
        opacity="0.35"
      />
      <path
        d="M452,194 Q490,185 520,175 Q550,168 570,190 Q590,210 610,210 Q650,208 700,200"
        fill="none"
        stroke={activeAlert === 3 ? "#f97316" : "#00d4ff"}
        strokeWidth="2"
        strokeDasharray="6,4"
        opacity={activeAlert === 3 ? "0.9" : "0.5"}
      />
      <path
        d="M463,211 Q462,225 465,230 Q470,230 475,225 Q490,218 520,225 Q535,228 545,226"
        fill="none"
        stroke={activeAlert === 2 ? "#f59e0b" : "#00d4ff"}
        strokeWidth="1.2"
        strokeDasharray="4,3"
        opacity="0.55"
      />

      {/* Hotspots with ML score badges */}
      {hotspots.map(h => {
        const ml = mlScores?.[h.id]
        return (
          <g key={h.id}>
            <circle cx={h.cx} cy={h.cy} r="28" fill={`url(#h-${h.sev})`} />
            <circle
              cx={h.cx}
              cy={h.cy}
              r="7"
              fill={SEV_COLOR[h.sev]}
              fillOpacity="0.18"
              stroke={SEV_COLOR[h.sev]}
              strokeWidth="1.2"
              strokeOpacity={activeAlert === h.id ? "1" : "0.65"}
            />
            <circle cx={h.cx} cy={h.cy} r="3.5" fill={SEV_COLOR[h.sev]} opacity={activeAlert === h.id ? "1" : "0.8"} />
            {activeAlert === h.id && (
              <circle cx={h.cx} cy={h.cy} r="12" fill="none" stroke={SEV_COLOR[h.sev]} strokeWidth="1" opacity="0.6">
                <animate attributeName="r" values="7;18;7" dur="1.8s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.6;0;0.6" dur="1.8s" repeatCount="indefinite" />
              </circle>
            )}
            {ml && (
              <text
                x={h.cx}
                y={h.cy - 14}
                fill={SEV_COLOR[h.sev]}
                fontSize="7.5"
                textAnchor="middle"
                fontFamily="DM Mono, monospace"
                fontWeight="700"
                opacity="0.95"
              >
                {ml.score}
              </text>
            )}
          </g>
        )
      })}

      {/* India ports */}
      {ports.map((p, i) => (
        <g key={i}>
          <circle cx={p.cx} cy={p.cy} r="3" fill="#00d4ff" opacity="0.9" />
          <circle cx={p.cx} cy={p.cy} r="6" fill="none" stroke="#00d4ff" strokeWidth="0.8" opacity="0.3" />
          <text x={p.cx + 8} y={p.cy + 3} fill="#00d4ff" fontSize="7" opacity="0.8" fontFamily="DM Mono, monospace">
            {p.label}
          </text>
        </g>
      ))}

      {/* Chokepoint labels */}
      <text x="316" y="196" fill="#ef4444" fontSize="7" opacity="0.9" fontFamily="DM Mono, monospace">RED SEA ⚡</text>
      <text x="318" y="155" fill="#f59e0b" fontSize="7" opacity="0.85" fontFamily="DM Mono, monospace">SUEZ ⚠</text>
      <text x="534" y="244" fill="#f97316" fontSize="7" opacity="0.85" fontFamily="DM Mono, monospace">MALACCA ⚠</text>
      <text x="422" y="246" fill="#f59e0b" fontSize="7" opacity="0.85" fontFamily="DM Mono, monospace">COLOMBO ⚠</text>
      <text x="148" y="230" fill="#f97316" fontSize="7" opacity="0.8" fontFamily="DM Mono, monospace">PANAMA ⚠</text>
      <text x="223" y="323" fill="#22c55e" fontSize="7" opacity="0.75" fontFamily="DM Mono, monospace">CAPE ✓</text>

      {/* Legend */}
      <g transform="translate(16,366)">
        <rect width="330" height="22" fill="#07111e" opacity="0.8" rx="3" />
        {[["#ef4444", "CRITICAL", 0], ["#f59e0b", "HIGH", 68], ["#f97316", "MEDIUM", 104], ["#22c55e", "LOW", 158]].map(([c, l, x]) => (
          <g key={l as string} transform={`translate(${x},0)`}>
            <circle cx="8" cy="11" r="4" fill={c as string} />
            <text x="16" y="15" fill="#8ba0bc" fontSize="7.5" fontFamily="DM Mono, monospace">
              {l as string}
            </text>
          </g>
        ))}
        <line x1="210" y1="11" x2="228" y2="11" stroke="#00d4ff" strokeWidth="1.5" strokeDasharray="4,2" />
        <text x="232" y="15" fill="#8ba0bc" fontSize="7.5" fontFamily="DM Mono, monospace">TRADE ROUTE</text>
      </g>
    </svg>
  )
}

// ─── Analytics Page ───────────────────────────────────────────────────────────

function AnalyticsPage() {
  const [period, setPeriod] = useState<"7d" | "30d" | "90d">("30d")

  const barData = [
    { label: "Conflict", count: 18, sev: "critical" as Severity },
    { label: "Port Strike", count: 7, sev: "high" as Severity },
    { label: "Weather", count: 24, sev: "medium" as Severity },
    { label: "Sanctions", count: 11, sev: "high" as Severity },
    { label: "Canal", count: 5, sev: "medium" as Severity },
    { label: "Tariff", count: 9, sev: "low" as Severity },
  ]
  const maxBar = Math.max(...barData.map(d => d.count))

  // Freight rate history (USD/TEU): Dec → Aug
  const freightHistory = [500, 680, 900, 1500, 2800, 4000, 3800]
  const allMonthLabels = ["Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov"]
  const xs = freightHistory.map((_, i) => i)
  const reg = linearRegression(xs, freightHistory)
  const forecasted = [7, 8, 9].map(x => Math.max(200, Math.round(reg.slope * x + reg.intercept)))

  const zScores = zScoreAnomalies(freightHistory)
  const anomalyThreshold = 1.5

  // SVG coordinate helpers
  const allVals = [...freightHistory, ...forecasted]
  const minVal = Math.min(...allVals)
  const maxVal = Math.max(...allVals)
  const toY = (v: number) => 10 + (1 - (v - minVal) / (maxVal - minVal || 1)) * 72

  const xStep = 30
  const histPoints = freightHistory.map((v, i) => ({ x: i * xStep, y: toY(v) }))
  const forecastPoints = forecasted.map((v, i) => ({ x: (freightHistory.length + i) * xStep, y: toY(v) }))
  const svgW = (allMonthLabels.length - 1) * xStep + 24

  const histPath = histPoints.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ")
  const forecastPath = [histPoints[histPoints.length - 1], ...forecastPoints]
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`)
    .join(" ")

  const corridors = [
    { name: "JNPT → Rotterdam", disruptions: 14, avgDelay: "16d", freightDelta: "+680%", trend: "up" },
    { name: "Kolkata → Hamburg", disruptions: 11, avgDelay: "21d", freightDelta: "+580%", trend: "up" },
    { name: "Chennai → Singapore", disruptions: 6, avgDelay: "4d", freightDelta: "+95%", trend: "stable" },
    { name: "Mundra → Shanghai", disruptions: 4, avgDelay: "2d", freightDelta: "+42%", trend: "stable" },
    { name: "Cochin → Jeddah", disruptions: 1, avgDelay: "—", freightDelta: "+12%", trend: "down" },
  ]

  return (
    <div style={{ padding: 24, overflowY: "auto", height: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>Analytics</h2>
        <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
          {(["7d", "30d", "90d"] as const).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              style={{
                padding: "4px 12px",
                fontSize: 10,
                fontFamily: "DM Mono, monospace",
                background: period === p ? "var(--primary-dim)" : "transparent",
                color: period === p ? "var(--primary)" : "var(--text-3)",
                border: `1px solid ${period === p ? "var(--primary)40" : "var(--border)"}`,
                borderRadius: 4,
                cursor: "pointer",
              }}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        {/* Bar chart */}
        <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 6, padding: 16 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.1em",
              color: "var(--text-3)",
              textTransform: "uppercase",
              marginBottom: 14,
            }}
          >
            Disruptions by Type · {period}
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 120 }}>
            {barData.map(d => (
              <div key={d.label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <span className="mono" style={{ fontSize: 9, color: SEV_COLOR[d.sev] }}>
                  {d.count}
                </span>
                <div
                  style={{
                    width: "100%",
                    height: `${(d.count / maxBar) * 90}px`,
                    background: SEV_COLOR[d.sev],
                    opacity: 0.75,
                    borderRadius: "3px 3px 0 0",
                    transition: "height 0.4s ease",
                  }}
                />
                <span style={{ fontSize: 8, color: "var(--text-3)", textAlign: "center" }}>{d.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Freight chart with LR forecast */}
        <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 6, padding: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.1em",
                color: "var(--text-3)",
                textTransform: "uppercase",
              }}
            >
              Freight Rate · Kolkata–Rotterdam
            </div>
            <span
              className="mono"
              style={{
                marginLeft: "auto",
                fontSize: 8,
                color: "var(--primary)",
                padding: "1px 5px",
                background: "var(--primary-dim)",
                borderRadius: 2,
              }}
            >
              LR R²={reg.r2.toFixed(2)}
            </span>
          </div>
          <div style={{ fontSize: 9, color: "var(--text-3)", marginBottom: 8 }}>
            Forecast Sep–Nov:{" "}
            <span className="mono" style={{ color: "var(--primary)" }}>
              ${forecasted[0].toLocaleString()}→${forecasted[2].toLocaleString()}/TEU
            </span>
            <span style={{ marginLeft: 6, color: reg.slope < 0 ? "#22c55e" : "#f59e0b" }}>
              {reg.slope < 0 ? "↓ easing" : "↑ rising"}
            </span>
          </div>
          <svg viewBox={`0 0 ${svgW} 108`} style={{ width: "100%", height: 108 }}>
            <defs>
              <linearGradient id="hist-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ef4444" stopOpacity="0.22" />
                <stop offset="100%" stopColor="#ef4444" stopOpacity="0" />
              </linearGradient>
              <linearGradient id="fore-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#00d4ff" stopOpacity="0.12" />
                <stop offset="100%" stopColor="#00d4ff" stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* Grid */}
            {[0.25, 0.5, 0.75].map(t => (
              <line key={t} x1="0" y1={10 + t * 72} x2={svgW} y2={10 + t * 72} stroke="#1a2d42" strokeWidth="0.5" />
            ))}

            {/* Historical fill */}
            <path d={`${histPath} L${histPoints[histPoints.length - 1].x},88 L0,88 Z`} fill="url(#hist-fill)" />
            {/* Forecast fill */}
            <path
              d={`${forecastPath} L${forecastPoints[forecastPoints.length - 1].x},88 L${histPoints[histPoints.length - 1].x},88 Z`}
              fill="url(#fore-fill)"
            />

            {/* Lines */}
            <path d={histPath} fill="none" stroke="#ef4444" strokeWidth="2" />
            <path d={forecastPath} fill="none" stroke="#00d4ff" strokeWidth="1.5" strokeDasharray="5,3" />

            {/* Separator */}
            <line
              x1={histPoints[histPoints.length - 1].x}
              y1="8"
              x2={histPoints[histPoints.length - 1].x}
              y2="88"
              stroke="#243447"
              strokeWidth="1"
              strokeDasharray="3,2"
            />
            <text x={histPoints[histPoints.length - 1].x + 2} y="16" fill="#4d6480" fontSize="6" fontFamily="DM Mono, monospace">
              → FORECAST
            </text>

            {/* Historical dots with anomaly markers */}
            {histPoints.map((p, i) => {
              const isAnomaly = zScores[i] > anomalyThreshold
              return (
                <g key={i}>
                  {isAnomaly && <circle cx={p.x} cy={p.y} r="7" fill="none" stroke="#f59e0b" strokeWidth="1" opacity="0.6" />}
                  <circle cx={p.x} cy={p.y} r={isAnomaly ? 3.5 : 2.5} fill={isAnomaly ? "#f59e0b" : "#ef4444"} />
                  <text x={p.x} y="101" fill="#4d6480" fontSize="6.5" textAnchor="middle" fontFamily="DM Mono, monospace">
                    {allMonthLabels[i]}
                  </text>
                </g>
              )
            })}

            {/* Forecast dots */}
            {forecastPoints.map((p, i) => (
              <g key={`f${i}`}>
                <circle cx={p.x} cy={p.y} r="2.5" fill="#00d4ff" opacity="0.75" />
                <text x={p.x} y="101" fill="#4d6480" fontSize="6.5" textAnchor="middle" fontFamily="DM Mono, monospace">
                  {allMonthLabels[freightHistory.length + i]}
                </text>
              </g>
            ))}

            {/* Y-axis */}
            <text x="2" y="87" fill="#4d6480" fontSize="6.5" fontFamily="DM Mono, monospace">${minVal}</text>
            <text x="2" y="17" fill="#4d6480" fontSize="6.5" fontFamily="DM Mono, monospace">${(maxVal / 1000).toFixed(1)}k</text>

            {/* Anomaly legend dot */}
            <circle cx={svgW - 46} cy="20" r="3.5" fill="#f59e0b" opacity="0.9" />
            <text x={svgW - 40} y="24" fill="#4d6480" fontSize="6" fontFamily="DM Mono, monospace">ANOMALY</text>
          </svg>
        </div>
      </div>

      {/* Z-score strip */}
      <div
        style={{
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: "10px 16px",
          marginBottom: 16,
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.1em",
            color: "var(--text-3)",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
          }}
        >
          Z-Score Anomaly · Freight
        </span>
        {freightHistory.map((_, i) => {
          const z = zScores[i]
          const isA = z > anomalyThreshold
          return (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
              <span className="mono" style={{ fontSize: 8, color: isA ? "#f59e0b" : "var(--text-3)", fontWeight: isA ? 700 : 400 }}>
                z={z.toFixed(1)}
              </span>
              <span style={{ fontSize: 7, color: "var(--text-3)" }}>{allMonthLabels[i]}</span>
            </div>
          )
        })}
        <span className="mono" style={{ marginLeft: "auto", fontSize: 9, color: "#f59e0b" }}>
          {zScores.filter(z => z > anomalyThreshold).length} anomalies detected
        </span>
      </div>

      {/* Corridor table */}
      <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
        <div
          style={{
            padding: "10px 16px",
            borderBottom: "1px solid var(--border)",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.1em",
            color: "var(--text-3)",
            textTransform: "uppercase",
          }}
        >
          Corridor Performance
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              {["Corridor", "Disruptions", "Avg Delay", "Freight Δ", "Trend"].map(h => (
                <th
                  key={h}
                  style={{
                    padding: "8px 16px",
                    fontSize: 9,
                    color: "var(--text-3)",
                    fontFamily: "DM Mono, monospace",
                    letterSpacing: "0.08em",
                    textAlign: "left",
                    fontWeight: 600,
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {corridors.map((c, i) => (
              <tr
                key={i}
                style={{
                  borderBottom: "1px solid var(--border)",
                  background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)",
                }}
              >
                <td style={{ padding: "8px 16px", fontSize: 11, color: "var(--text)", fontWeight: 500 }}>{c.name}</td>
                <td className="mono" style={{ padding: "8px 16px", fontSize: 11, color: "var(--text-2)" }}>
                  {c.disruptions}
                </td>
                <td
                  className="mono"
                  style={{ padding: "8px 16px", fontSize: 11, color: c.avgDelay === "—" ? "var(--text-3)" : "#f59e0b" }}
                >
                  {c.avgDelay}
                </td>
                <td className="mono" style={{ padding: "8px 16px", fontSize: 11, color: "#ef4444" }}>
                  {c.freightDelta}
                </td>
                <td style={{ padding: "8px 16px" }}>
                  <span
                    style={{
                      fontSize: 14,
                      color: c.trend === "up" ? "#ef4444" : c.trend === "down" ? "#22c55e" : "#f59e0b",
                    }}
                  >
                    {c.trend === "up" ? "↑" : c.trend === "down" ? "↓" : "→"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function RoutePlannerPage() {
  const [from, setFrom] = useState("JNPT")
  const [to, setTo] = useState("Rotterdam")
  const [cargo, setCargo] = useState("General Cargo")
  const [planned, setPlanned] = useState(false)
  const [selectedRoute, setSelectedRoute] = useState<number | null>(null)

  const ports = ["JNPT", "Mundra", "Chennai", "Kolkata", "Cochin"]
  const destinations = ["Rotterdam", "Hamburg", "Shanghai", "Singapore", "Los Angeles", "Jeddah"]
  const cargoTypes = ["General Cargo", "Basmati Rice", "Petroleum", "Textiles", "Chemicals", "Machinery"]

  const options = [
    {
      route: "via Suez Canal",
      days: 22,
      cost: "₹3,840/TEU",
      risk: "critical" as Severity,
      riskScore: 91,
      note: "HIGH RISK — Active conflict in Red Sea",
    },
    {
      route: "via Cape of Good Hope",
      days: 36,
      cost: "₹5,080/TEU",
      risk: "low" as Severity,
      riskScore: 18,
      note: "SAFE — Recommended during current crisis",
    },
    {
      route: "via Cape + Durban bunker",
      days: 38,
      cost: "₹4,920/TEU",
      risk: "low" as Severity,
      riskScore: 22,
      note: "SAFE — Optimized bunkering en route",
    },
  ]

  const exportRoutePdf = (opt: typeof options[number]) => {
    const w = window.open("", "_blank")
    if (!w) return
    w.document.write(`
      <html>
        <head>
          <title>Route Summary - ${from} to ${to}</title>
          <style>
            body { font-family: -apple-system, sans-serif; padding: 40px; color: #111; }
            h1 { font-size: 20px; margin-bottom: 4px; }
            .sub { color: #666; margin-bottom: 24px; font-size: 13px; }
            table { border-collapse: collapse; width: 100%; }
            td { padding: 8px 0; border-bottom: 1px solid #eee; font-size: 14px; }
            td:first-child { color: #666; width: 160px; }
            .note { margin-top: 16px; font-size: 13px; color: #444; }
          </style>
        </head>
        <body>
          <h1>UNILOG Route Summary</h1>
          <div class="sub">${from} &rarr; ${to} &middot; ${cargo}</div>
          <table>
            <tr><td>Route</td><td>${opt.route}</td></tr>
            <tr><td>Transit Time</td><td>${opt.days} days</td></tr>
            <tr><td>Cost</td><td>${opt.cost}</td></tr>
            <tr><td>ML Risk Score</td><td>${opt.riskScore} / 100 (${opt.risk})</td></tr>
          </table>
          <div class="note">${opt.note}</div>
        </body>
      </html>
    `)
    w.document.close()
    w.focus()
    w.print()
  }

  return (
    <div style={{ padding: 24, overflowY: "auto", height: "100%" }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 20 }}>Route Planner</h2>
      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 20 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[
            { label: "Origin Port", value: from, setter: setFrom, options: ports },
            { label: "Destination", value: to, setter: setTo, options: destinations },
            { label: "Cargo Type", value: cargo, setter: setCargo, options: cargoTypes },
          ].map(({ label, value, setter, options: opts }) => (
            <div key={label}>
              <div
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  color: "var(--text-3)",
                  textTransform: "uppercase",
                  marginBottom: 6,
                }}
              >
                {label}
              </div>
              <select
                value={value}
                onChange={e => {
                  setter(e.target.value)
                  setPlanned(false)
                }}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  background: "var(--panel)",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  color: "var(--text)",
                  fontSize: 12,
                  fontFamily: "Outfit, sans-serif",
                  cursor: "pointer",
                }}
              >
                {opts.map(o => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </div>
          ))}
          <button
            onClick={() => { setPlanned(true); setSelectedRoute(null) }}
            style={{
              marginTop: 4,
              padding: "10px",
              background: "var(--primary)",
              color: "#000",
              fontWeight: 700,
              fontSize: 11,
              fontFamily: "DM Mono, monospace",
              letterSpacing: "0.08em",
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            CALCULATE ROUTES
          </button>
        </div>

        {planned ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div
              style={{
                fontSize: 10,
                color: "var(--text-3)",
                fontWeight: 600,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
              }}
            >
              {from} → {to} · {cargo} · 3 options found
            </div>
            {options.map((opt, i) => (
              <div
                key={i}
                style={{
                  background: "var(--panel)",
                  border: `1px solid ${selectedRoute === i ? "#3b82f6" : i === 1 ? "#22c55e40" : "var(--border)"}`,
                  borderLeft: `2px solid ${SEV_COLOR[opt.risk]}`,
                  borderRadius: 6,
                  padding: 16,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{opt.route}</span>
                  {i === 1 && (
                    <span
                      style={{
                        fontSize: 8,
                        fontWeight: 700,
                        color: "#22c55e",
                        padding: "2px 6px",
                        background: "rgba(34,197,94,0.1)",
                        borderRadius: 3,
                        letterSpacing: "0.08em",
                      }}
                    >
                      RECOMMENDED
                    </span>
                  )}
                  <span style={{ marginLeft: "auto", fontSize: 9, color: "var(--text-3)" }}>{opt.note}</span>
                </div>
                <div style={{ display: "flex", gap: 20, marginBottom: 10 }}>
                  {[["Transit", `${opt.days} days`], ["Cost", opt.cost], ["ML Risk", String(opt.riskScore)]].map(([k, v]) => (
                    <div key={k}>
                      <div style={{ fontSize: 9, color: "var(--text-3)", marginBottom: 2 }}>{k}</div>
                      <div
                        className="mono"
                        style={{ fontSize: 14, fontWeight: 500, color: k === "ML Risk" ? SEV_COLOR[opt.risk] : "var(--text)" }}
                      >
                        {v}
                      </div>
                    </div>
                  ))}
                </div>
                <RiskBar score={opt.riskScore} sev={opt.risk} />
                <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                  <Btn onClick={() => setSelectedRoute(i)}>
                    {selectedRoute === i ? "\u2713 SELECTED" : "SELECT ROUTE"}
                  </Btn>
                  <Btn onClick={() => exportRoutePdf(opt)}>EXPORT PDF</Btn>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "var(--panel)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--text-3)",
              fontSize: 12,
            }}
          >
            Configure route and click Calculate
          </div>
        )}
      </div>
    </div>
  )
}

function AlertsPage({ alerts, onDismiss, onNotify }: { alerts: AlertEvent[]; onDismiss: (id: number) => void; onNotify: (id: number) => void }) {
  const [filter, setFilter] = useState<Severity | "all">("all")
  const filtered = filter === "all" ? alerts : alerts.filter(a => a.severity === filter)

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.1em",
            color: "var(--text-3)",
            textTransform: "uppercase",
            marginRight: 8,
          }}
        >
          Filter:
        </span>
        {(["all", "critical", "high", "medium", "low"] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: "3px 10px",
              fontSize: 9,
              fontFamily: "DM Mono, monospace",
              fontWeight: 600,
              letterSpacing: "0.08em",
              borderRadius: 3,
              border: `1px solid ${filter === f && f !== "all" ? SEV_COLOR[f as Severity] + "60" : "var(--border)"}`,
              background: filter === f ? (f === "all" ? "var(--primary-dim)" : SEV_BG[f as Severity]) : "transparent",
              color: filter === f ? (f === "all" ? "var(--primary)" : SEV_COLOR[f as Severity]) : "var(--text-3)",
              cursor: "pointer",
              textTransform: "uppercase",
            }}
          >
            {f}
          </button>
        ))}
        <span className="mono" style={{ marginLeft: "auto", fontSize: 10, color: "var(--text-3)" }}>
          {filtered.filter(a => !a.dismissed).length} active
        </span>
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {filtered
          .filter(a => !a.dismissed)
          .map(a => (
            <div
              key={a.id}
              style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", borderLeft: `2px solid ${SEV_COLOR[a.severity]}` }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span className="mono" style={{ fontSize: 9, color: "var(--text-3)" }}>
                  {a.time}
                </span>
                <span
                  className="mono"
                  style={{
                    fontSize: 8,
                    letterSpacing: "0.1em",
                    fontWeight: 600,
                    padding: "1px 5px",
                    background: SEV_BG[a.severity],
                    color: SEV_COLOR[a.severity],
                    borderRadius: 2,
                  }}
                >
                  {a.type}
                </span>
                <SeverityBadge sev={a.severity} />
                <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  <Btn small onClick={() => onNotify(a.id)}>NOTIFY TEAM</Btn>
                  <Btn small danger onClick={() => onDismiss(a.id)}>
                    DISMISS
                  </Btn>
                </span>
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 3 }}>{a.location}</div>
              <div className="mono" style={{ fontSize: 9, color: "var(--text-3)", marginBottom: 4 }}>
                {a.route}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-2)", lineHeight: 1.6 }}>{a.summary}</div>
            </div>
          ))}
        {filtered.filter(a => !a.dismissed).length === 0 && (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-3)", fontSize: 12 }}>No active alerts for this filter.</div>
        )}
      </div>
    </div>
  )
}

function SettingsPage() {
  const [notif, setNotif] = useState({ email: true, whatsapp: false, sms: true })
  const [thresh, setThresh] = useState<Severity>("high")
  const [saved, setSaved] = useState(false)

  function save() {
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div style={{ padding: 24, maxWidth: 560, overflowY: "auto", height: "100%" }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 24 }}>Settings</h2>

      <section style={{ marginBottom: 28 }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.1em",
            color: "var(--text-3)",
            textTransform: "uppercase",
            marginBottom: 12,
          }}
        >
          Alert Notifications
        </div>
        {(["email", "whatsapp", "sms"] as const).map(ch => (
          <div
            key={ch}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 0",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <div>
              <div style={{ fontSize: 12, fontWeight: 500, textTransform: "capitalize", marginBottom: 2 }}>
                {ch === "sms" ? "SMS" : ch.charAt(0).toUpperCase() + ch.slice(1)}
              </div>
              <div style={{ fontSize: 10, color: "var(--text-3)" }}>{ch === "email" ? "aparnadhiraj07@gmail.com" : "+91 73566 75700"}</div>
            </div>
            <div
              onClick={() => setNotif(n => ({ ...n, [ch]: !n[ch] }))}
              style={{
                width: 40,
                height: 22,
                borderRadius: 11,
                background: notif[ch] ? "var(--primary)" : "var(--border)",
                position: "relative",
                cursor: "pointer",
                transition: "background 0.2s",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: 3,
                  left: notif[ch] ? 20 : 3,
                  width: 16,
                  height: 16,
                  borderRadius: "50%",
                  background: "#fff",
                  transition: "left 0.2s",
                }}
              />
            </div>
          </div>
        ))}
      </section>

      <section style={{ marginBottom: 28 }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.1em",
            color: "var(--text-3)",
            textTransform: "uppercase",
            marginBottom: 12,
          }}
        >
          Alert Threshold
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {(["critical", "high", "medium", "low"] as const).map(s => (
            <button
              key={s}
              onClick={() => setThresh(s)}
              style={{
                flex: 1,
                padding: "8px 4px",
                borderRadius: 4,
                border: `1px solid ${thresh === s ? SEV_COLOR[s] + "60" : "var(--border)"}`,
                background: thresh === s ? SEV_BG[s] : "transparent",
                color: thresh === s ? SEV_COLOR[s] : "var(--text-3)",
                fontSize: 9,
                fontFamily: "DM Mono, monospace",
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                cursor: "pointer",
              }}
            >
              {s}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 8 }}>
          Receive alerts for severity ≥ <span style={{ color: SEV_COLOR[thresh] }}>{thresh}</span>
        </div>
      </section>

      <section style={{ marginBottom: 28 }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.1em",
            color: "var(--text-3)",
            textTransform: "uppercase",
            marginBottom: 12,
          }}
        >
          Data Sources
        </div>
        {[
          ["NewsAPI / GNews", "Active", "Connected"],
          ["DGFT Trade Advisories", "Active", "Connected"],
          ["OpenWeatherMap", "Active", "Connected"],
          ["Port Authority Feeds", "Partial", "3/5 ports"],
          ["Conflict Monitor", "Active", "Connected"],
        ].map(([name, status, detail]) => (
          <div
            key={name}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "8px 0",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <span style={{ fontSize: 11, color: "var(--text-2)" }}>{name}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 9, color: "var(--text-3)" }}>{detail}</span>
              <span
                className="mono"
                style={{
                  fontSize: 9,
                  fontWeight: 600,
                  color: status === "Active" ? "#22c55e" : "#f59e0b",
                  padding: "2px 6px",
                  background: status === "Active" ? "rgba(34,197,94,0.1)" : "rgba(245,158,11,0.1)",
                  borderRadius: 3,
                }}
              >
                {status}
              </span>
            </div>
          </div>
        ))}
      </section>

      <div style={{ display: "flex", gap: 10 }}>
        <button
          onClick={save}
          style={{
            padding: "9px 24px",
            background: saved ? "#22c55e" : "var(--primary)",
            color: "#000",
            fontWeight: 700,
            fontSize: 11,
            fontFamily: "DM Mono, monospace",
            letterSpacing: "0.08em",
            border: "none",
            borderRadius: 4,
            cursor: "pointer",
            transition: "background 0.3s",
          }}
        >
          {saved ? "SAVED ✓" : "SAVE SETTINGS"}
        </button>
      </div>
    </div>
  )
}

// ─── Dashboard View ───────────────────────────────────────────────────────────

function DashboardView({
  alerts,
  routes,
  reroutes,
  activeAlert,
  setActiveAlert,
  onDismissAlert,
  onToggleWatch,
  onApplyReroute,
  onDismissReroute,
  onGenerateReroutes,
  generatingReroutes,
  mlScores,
  mlRunning,
  aiAnalysis,
  aiLoading,
  onGenerateAI,
  expandedMLId,
  setExpandedMLId,
}: {
  alerts: AlertEvent[]
  routes: Route[]
  reroutes: Reroute[]
  activeAlert: number | null
  setActiveAlert: (id: number | null) => void
  onDismissAlert: (id: number) => void
  onToggleWatch: (id: string) => void
  onApplyReroute: (id: number) => void
  onDismissReroute: (id: number) => void
  onGenerateReroutes: () => void
  generatingReroutes: boolean
  mlScores: Record<number, MLScore>
  mlRunning: boolean
  aiAnalysis: string
  aiLoading: boolean
  onGenerateAI: () => void
  expandedMLId: number | null
  setExpandedMLId: (id: number | null) => void
}) {
  const [activeTab, setActiveTab] = useState<"alerts" | "watchlist">("alerts")
  const liveAlerts = alerts.filter(a => !a.dismissed)

  return (
    <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
      {/* Left column: map, stats, tabs, list */}
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
        {/* Map */}
        <div style={{ flex: 1, minHeight: 0, position: "relative", borderBottom: "1px solid var(--border)" }}>
          <div
            style={{
              width: "100%",
              height: "100%",
              minHeight: 0,
              position: "relative",
              overflow: "hidden",
            }}
          >
            <LiveMapCanvas />
          </div>
          {mlRunning && (
            <div style={{ position: "absolute", top: 44, right: 12 }}>
              <div
                style={{
                  padding: "3px 8px",
                  background: "rgba(0,212,255,0.07)",
                  border: "1px solid rgba(0,212,255,0.22)",
                  borderRadius: 4,
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <span
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: "50%",
                    background: "var(--primary)",
                    animation: "blink 0.8s ease infinite",
                    display: "inline-block",
                  }}
                />
                <span className="mono" style={{ fontSize: 8, color: "var(--primary)" }}>
                  ML MODEL RUNNING
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Stats row */}
        <div style={{ display: "flex", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          {STATS.map((s, i) => {
            const isNeg = s.delta?.startsWith("−") || s.delta?.startsWith("-")
            return (
              <div key={i} style={{ padding: "10px 14px", borderRight: "1px solid var(--border)", flex: 1 }}>
                <div
                  style={{
                    fontSize: 9,
                    color: "var(--text-3)",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    marginBottom: 3,
                    fontWeight: 600,
                  }}
                >
                  {s.label}
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span className="mono" style={{ fontSize: 20, fontWeight: 500, color: "var(--text)", letterSpacing: "-0.02em" }}>
                    {s.value}
                  </span>
                  {s.delta && (
                    <span className="mono" style={{ fontSize: 9, color: isNeg ? "#ef4444" : "#22c55e" }}>
                      {s.delta}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 9, color: "var(--text-3)", marginTop: 1 }}>{s.sub}</div>
              </div>
            )
          })}
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          {(["alerts", "watchlist"] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: "7px 16px",
                background: "transparent",
                border: "none",
                borderBottom: `2px solid ${activeTab === tab ? "var(--primary)" : "transparent"}`,
                color: activeTab === tab ? "var(--primary)" : "var(--text-3)",
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.1em",
                cursor: "pointer",
                textTransform: "uppercase",
                fontFamily: "DM Mono, monospace",
              }}
            >
              {tab === "alerts" ? `Disruption Alerts (${liveAlerts.length})` : `Route Watchlist (${routes.filter(r => r.watched).length})`}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
          {activeTab === "alerts"
            ? liveAlerts.map(a => {
                const ml = mlScores[a.id]
                const expanded = expandedMLId === a.id
                return (
                  <div
                    key={a.id}
                    onClick={() => setActiveAlert(activeAlert === a.id ? null : a.id)}
                    style={{
                      padding: "10px 14px",
                      borderBottom: "1px solid var(--border)",
                      cursor: "pointer",
                      background: activeAlert === a.id ? SEV_BG[a.severity] : "transparent",
                      borderLeft: `2px solid ${activeAlert === a.id ? SEV_COLOR[a.severity] : "transparent"}`,
                      transition: "all 0.15s",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <span className="mono" style={{ fontSize: 9, color: "var(--text-3)" }}>
                        {a.time}
                      </span>
                      <span
                        className="mono"
                        style={{
                          fontSize: 8,
                          letterSpacing: "0.1em",
                          fontWeight: 600,
                          padding: "1px 5px",
                          background: SEV_BG[a.severity],
                          color: SEV_COLOR[a.severity],
                          borderRadius: 2,
                        }}
                      >
                        {a.type}
                      </span>
                      <SeverityBadge sev={a.severity} />
                      {ml && (
                        <button
                          onClick={e => {
                            e.stopPropagation()
                            setExpandedMLId(expanded ? null : a.id)
                          }}
                          style={{
                            fontSize: 8,
                            fontFamily: "DM Mono, monospace",
                            padding: "1px 6px",
                            background: "var(--primary-dim)",
                            color: "var(--primary)",
                            border: "1px solid var(--primary)30",
                            borderRadius: 2,
                            cursor: "pointer",
                          }}
                        >
                          ML {ml.score} · {ml.confidence}% {expanded ? "▴" : "▾"}
                        </button>
                      )}
                      {!ml && mlRunning && (
                        <span className="mono" style={{ fontSize: 7, color: "var(--text-3)", animation: "blink 1s infinite" }}>
                          scoring…
                        </span>
                      )}
                      <span style={{ marginLeft: "auto", display: "flex", gap: 6 }} onClick={e => e.stopPropagation()}>
                        <Btn small danger onClick={() => onDismissAlert(a.id)}>
                          ✕
                        </Btn>
                      </span>
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 500, marginBottom: 2 }}>{a.location}</div>
                    <div className="mono" style={{ fontSize: 9, color: "var(--text-3)", marginBottom: 3 }}>
                      {a.route}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-2)", lineHeight: 1.5 }}>{a.summary}</div>
                    {expanded && ml && (
                      <div
                        onClick={e => e.stopPropagation()}
                        style={{
                          marginTop: 8,
                          padding: "8px 10px",
                          background: "var(--panel-2)",
                          borderRadius: 4,
                          border: "1px solid var(--border)",
                        }}
                      >
                        <div style={{ fontSize: 8, fontWeight: 700, color: "var(--primary)", letterSpacing: "0.1em", marginBottom: 2 }}>
                          FEATURE IMPORTANCE
                        </div>
                        <FeatureChart features={ml.features} />
                      </div>
                    )}
                  </div>
                )
              })
            : routes.map(r => (
                <div
                  key={r.id}
                  style={{
                    padding: "8px 14px",
                    borderBottom: "1px solid var(--border)",
                    display: "grid",
                    gridTemplateColumns: "1fr auto",
                    gap: 8,
                    alignItems: "center",
                  }}
                >
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                      <span style={{ fontSize: 11, fontWeight: 600 }}>{r.from}</span>
                      <span style={{ color: "var(--text-3)", fontSize: 10 }}>→</span>
                      <span style={{ fontSize: 11, fontWeight: 600 }}>{r.to}</span>
                      <span style={{ fontSize: 9, color: "var(--text-3)", fontStyle: "italic" }}>via {r.via}</span>
                    </div>
                    <RiskBar score={r.score} sev={r.risk} />
                    <div className="mono" style={{ fontSize: 9, color: "var(--text-3)", marginTop: 3 }}>
                      {r.freight} · delay {r.delay}
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 5, alignItems: "flex-end" }}>
                    <span
                      className="mono"
                      style={{
                        fontSize: 8,
                        letterSpacing: "0.1em",
                        fontWeight: 700,
                        padding: "2px 6px",
                        background: SEV_BG[r.risk],
                        color: SEV_COLOR[r.risk],
                        borderRadius: 2,
                      }}
                    >
                      {r.status}
                    </span>
                    <button
                      onClick={() => onToggleWatch(r.id)}
                      style={{
                        fontSize: 9,
                        fontFamily: "DM Mono, monospace",
                        padding: "2px 7px",
                        background: r.watched ? "rgba(0,212,255,0.12)" : "transparent",
                        color: r.watched ? "var(--primary)" : "var(--text-3)",
                        border: `1px solid ${r.watched ? "var(--primary)40" : "var(--border)"}`,
                        borderRadius: 3,
                        cursor: "pointer",
                      }}
                    >
                      {r.watched ? "★ WATCHING" : "☆ WATCH"}
                    </button>
                  </div>
                </div>
              ))}
        </div>
      </div>

      {/* Right: AI Rerouting + ML Panel */}
      <div style={{ width: 300, borderLeft: "1px solid var(--border)", display: "flex", flexDirection: "column", flexShrink: 0, background: "var(--panel)" }}>
        <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", color: "var(--text-2)", textTransform: "uppercase" }}>
            AI Rerouting
          </span>
          <span className="mono" style={{ marginLeft: "auto", fontSize: 9, color: "#22c55e" }}>
            {reroutes.filter(r => !r.applied && !r.dismissed).length} suggestions
          </span>
        </div>
        <div style={{ padding: "8px 14px 0" }}>
          <button
            onClick={onGenerateReroutes}
            disabled={generatingReroutes}
            style={{
              width: "100%",
              padding: "6px 10px",
              fontSize: 9,
              fontFamily: "DM Mono, monospace",
              fontWeight: 700,
              letterSpacing: "0.06em",
              background: "var(--primary-dim)",
              color: "var(--primary)",
              border: "1px solid var(--primary)40",
              borderRadius: 4,
              cursor: generatingReroutes ? "default" : "pointer",
              opacity: generatingReroutes ? 0.6 : 1,
            }}
          >
            {generatingReroutes ? "GENERATING…" : "⟳ GENERATE SUGGESTIONS"}
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", paddingTop: 10 }}>
          {reroutes
            .filter(r => !r.dismissed)
            .map(rr => (
              <div
                key={rr.id}
                style={{
                  margin: "0 12px 10px",
                  padding: "10px 12px",
                  background: rr.applied ? "rgba(34,197,94,0.06)" : "var(--panel-2)",
                  border: `1px solid ${rr.applied ? "#22c55e40" : "var(--border)"}`,
                  borderRadius: 5,
                  borderLeft: "2px solid #22c55e",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                  <span style={{ fontSize: 9, color: "#22c55e", fontWeight: 700, letterSpacing: "0.08em" }}>
                    {rr.applied ? "✓ APPLIED" : "AI SUGGESTION"}
                  </span>
                  <span className="mono" style={{ marginLeft: "auto", fontSize: 9, color: "#22c55e" }}>
                    {rr.confidence}% conf.
                  </span>
                </div>
                <div className="mono" style={{ fontSize: 9, color: "var(--text-3)", marginBottom: 2, textDecoration: "line-through" }}>
                  {rr.original}
                </div>
                <div className="mono" style={{ fontSize: 10, color: "var(--text)", fontWeight: 500, marginBottom: 4 }}>
                  {rr.alt}
                </div>
                <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                  <span className="mono" style={{ fontSize: 9, color: "#f59e0b" }}>
                    +{rr.extraDays}d
                  </span>
                  <span className="mono" style={{ fontSize: 9, color: "#f59e0b" }}>
                    {rr.extraCost}
                  </span>
                  <span className="mono" style={{ fontSize: 9, color: "var(--text-3)" }}>
                    via {rr.via}
                  </span>
                </div>
                <div style={{ fontSize: 10, color: "var(--text-3)", lineHeight: 1.5, marginBottom: rr.applied ? 0 : 10 }}>{rr.reason}</div>
                {!rr.applied && (
                  <div style={{ display: "flex", gap: 6 }}>
                    <Btn small onClick={() => onApplyReroute(rr.id)}>
                      APPLY
                    </Btn>
                    <Btn small danger onClick={() => onDismissReroute(rr.id)}>
                      DISMISS
                    </Btn>
                  </div>
                )}
              </div>
            ))}
          {reroutes.filter(r => !r.dismissed).length === 0 && (
            <div style={{ padding: 20, textAlign: "center", fontSize: 11, color: "var(--text-3)" }}>All suggestions processed.</div>
          )}
        </div>

        {/* ML Risk Engine */}
        <div style={{ borderTop: "1px solid var(--border)", padding: "12px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", color: "var(--text-3)", textTransform: "uppercase" }}>
              ML Risk Engine
            </span>
            {mlRunning ? (
              <span className="mono" style={{ fontSize: 8, color: "var(--primary)", animation: "blink 0.9s infinite" }}>
                ◉ RUNNING
              </span>
            ) : Object.keys(mlScores).length > 0 ? (
              <span className="mono" style={{ fontSize: 8, color: "#22c55e" }}>
                ✓ SCORED
              </span>
            ) : null}
          </div>
          {alerts
            .filter(a => !a.dismissed)
            .slice(0, 4)
            .map(a => {
              const ml = mlScores[a.id]
              return (
                <div key={a.id} style={{ marginBottom: 9 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ fontSize: 9, color: "var(--text-2)" }}>
                      {a.type} · {a.location.split(",")[0]}
                    </span>
                    <span className="mono" style={{ fontSize: 9, color: SEV_COLOR[a.severity] }}>
                      {ml ? (
                        <>
                          {ml.score}
                          <span style={{ color: "var(--text-3)", fontSize: 8, marginLeft: 3 }}>{ml.confidence}%</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </span>
                  </div>
                  {ml ? <RiskBar score={ml.score} sev={a.severity} /> : <ShimmerBar />}
                </div>
              )
            })}
        </div>

        {/* Groq AI Analysis */}
        <div style={{ borderTop: "1px solid var(--border)", padding: "10px 14px" }}>
          {aiAnalysis ? (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 7 }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: "#22c55e", letterSpacing: "0.08em" }}>✦ GROQ AI · LLAMA 3.3</span>
                <button
                  onClick={onGenerateAI}
                  style={{
                    marginLeft: "auto",
                    fontSize: 8,
                    fontFamily: "DM Mono, monospace",
                    padding: "1px 6px",
                    background: "transparent",
                    color: "var(--text-3)",
                    border: "1px solid var(--border)",
                    borderRadius: 2,
                    cursor: "pointer",
                  }}
                >
                  REFRESH
                </button>
              </div>
              <div style={{ fontSize: 10, color: "var(--text-2)", lineHeight: 1.7 }}>{aiAnalysis}</div>
            </div>
          ) : (
            <>
              <Btn small onClick={onGenerateAI}>
                {aiLoading ? "✦ ANALYZING…" : "✦ AI SITUATION ANALYSIS"}
              </Btn>
              {aiLoading && (
                <div style={{ marginTop: 8 }}>
                  {[88, 68, 50].map((w, i) => (
                    <div
                      key={i}
                      style={{
                        height: 2,
                        borderRadius: 1,
                        marginBottom: 5,
                        background: "linear-gradient(90deg, #1a2d42 0%, #243447 50%, #1a2d42 100%)",
                        backgroundSize: "200% 100%",
                        animation: "shimmer 1.4s ease infinite",
                        width: `${w}%`,
                      }}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div style={{ borderTop: "1px solid var(--border)", padding: "5px 14px" }}>
          <span className="mono" style={{ fontSize: 7, color: "var(--text-3)" }}>
            sigmoid risk · z-score anomaly · LR forecast · groq llama-3.3
          </span>
        </div>
      </div>
    </div>
  )
}

// ─── Full Map Page ─────────────────────────────────────────────────────────────

function MapPage({
  activeAlert,
  setActiveAlert,
  alerts,
  mlScores,
}: {
  activeAlert: number | null
  setActiveAlert: (id: number | null) => void
  alerts: AlertEvent[]
  mlScores: Record<number, MLScore>
}) {
  return (
    <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
      <div style={{ flex: 1, position: "relative" }}>
        <WorldMap activeAlert={activeAlert} mlScores={mlScores} fullscreen />
        <div style={{ position: "absolute", top: 12, left: 12 }}>
          <div
            style={{
              padding: "5px 10px",
              background: "rgba(7,10,17,0.9)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.1em",
              color: "var(--text-3)",
            }}
          >
            FULL MAP VIEW · INDIA TRADE CORRIDORS
          </div>
        </div>
      </div>
      <div style={{ width: 260, borderLeft: "1px solid var(--border)", background: "var(--panel)", display: "flex", flexDirection: "column" }}>
        <div
          style={{
            padding: "10px 14px",
            borderBottom: "1px solid var(--border)",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.1em",
            color: "var(--text-3)",
            textTransform: "uppercase",
          }}
        >
          Active Events
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {alerts
            .filter(a => !a.dismissed)
            .map(a => {
              const ml = mlScores[a.id]
              return (
                <div
                  key={a.id}
                  onClick={() => setActiveAlert(activeAlert === a.id ? null : a.id)}
                  style={{
                    padding: "10px 14px",
                    borderBottom: "1px solid var(--border)",
                    cursor: "pointer",
                    background: activeAlert === a.id ? SEV_BG[a.severity] : "transparent",
                    borderLeft: `2px solid ${activeAlert === a.id ? SEV_COLOR[a.severity] : "transparent"}`,
                  }}
                >
                  <div style={{ display: "flex", gap: 6, marginBottom: 4, alignItems: "center" }}>
                    <SeverityBadge sev={a.severity} />
                    <span className="mono" style={{ fontSize: 8, color: "var(--text-3)" }}>
                      {a.time}
                    </span>
                    {ml && (
                      <span className="mono" style={{ marginLeft: "auto", fontSize: 8, color: SEV_COLOR[a.severity] }}>
                        ML {ml.score}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 600 }}>{a.location}</div>
                  <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>{a.type}</div>
                </div>
              )
            })}
        </div>
      </div>
    </div>
  )
}

// ─── Root App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [page, setPage] = useState<NavPage>("dashboard")
  const [activeAlert, setActiveAlert] = useState<number | null>(1)
  const [alerts, setAlerts] = useState<AlertEvent[]>([])
  const [routes, setRoutes] = useState<Route[]>([])
  const [reroutes, setReroutes] = useState<Reroute[]>([])
  const [dataLoading, setDataLoading] = useState(true)
  const [dataError, setDataError] = useState<string | null>(null)
  const [currentTime, setCurrentTime] = useState("")
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchVal, setSearchVal] = useState("")

  // ML state
  const [mlScores, setMlScores] = useState<Record<number, MLScore>>({})
  const [mlRunning, setMlRunning] = useState(false)
  const [expandedMLId, setExpandedMLId] = useState<number | null>(null)

  // Reroute generation state
  const [generatingReroutes, setGeneratingReroutes] = useState(false)

  // Sidebar collapse state
  const [navCollapsed, setNavCollapsed] = useState(false)

  // Gemini AI state
  const [aiAnalysis, setAiAnalysis] = useState("")
  const [aiLoading, setAiLoading] = useState(false)

  useEffect(() => {
    const update = () => setCurrentTime(new Date().toLocaleTimeString("en-IN", { hour12: false }))
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [])

  // Load real data from the backend on mount, replacing the old hardcoded mocks.
  useEffect(() => {
    let cancelled = false
    fetchDashboardData()
      .then(data => {
        if (cancelled) return
        setAlerts(data.alerts)
        setRoutes(data.routes)
        setReroutes(data.reroutes)
        setDataError(null)
      })
      .catch(err => {
        if (!cancelled) setDataError(err instanceof Error ? err.message : "Failed to load data")
      })
      .finally(() => {
        if (!cancelled) setDataLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // ML scoring pipeline — runs whenever active alerts change
  useEffect(() => {
    const live = alerts.filter(a => !a.dismissed)
    if (live.length === 0) {
      setMlScores({})
      return
    }

    setMlRunning(true)
    setMlScores({})

    // Stagger computation to simulate pipeline stages
    const timers: ReturnType<typeof setTimeout>[] = []
    live.forEach((alert, i) => {
      const t = setTimeout(() => {
        const score = computeRiskScore(alert, routes)
        setMlScores(prev => ({ ...prev, [alert.id]: score }))
        if (i === live.length - 1) setMlRunning(false)
      }, 280 + i * 160)
      timers.push(t)
    })

    return () => timers.forEach(clearTimeout)
  }, [alerts, routes])

  // Simulate alert age ticking (re-triggers ML scoring via alert state change)
  useEffect(() => {
    const interval = setInterval(() => {
      setAlerts(prev => prev.map(a => (a.dismissed ? a : { ...a, ageMin: a.ageMin + 1 })))
    }, 60_000)
    return () => clearInterval(interval)
  }, [])

  async function generateAI() {
    if (aiLoading) return
    setAiLoading(true)
    const live = alerts.filter(a => !a.dismissed)
    const ranked = Object.entries(mlScores).sort((a, b) => b[1].score - a[1].score)
    const topEntry = ranked[0]
    const topAlert = topEntry ? live.find(a => a.id === Number(topEntry[0])) : live[0]

    try {
      const text = await callRiskAnalysis({
        alerts: live.map(a => ({ severity: a.severity, type: a.type, location: a.location, summary: a.summary })),
        top_location: topAlert && topEntry ? topAlert.location : undefined,
        top_score: topAlert && topEntry ? topEntry[1].score : undefined,
        top_confidence: topAlert && topEntry ? topEntry[1].confidence : undefined,
      })
      setAiAnalysis(text)
    } catch (e: any) {
      setAiAnalysis(`Error: ${e.message}`)
    }
    setAiLoading(false)
  }

  const dismissAlert = (id: number) => {
    setAlerts(prev => prev.map(a => (a.id === id ? { ...a, dismissed: true } : a)))
    dismissAlertApi(id).catch(err => console.error("Failed to dismiss alert on server:", err))
  }

  const notifyTeam = (id: number) => {
    const alert = alerts.find(a => a.id === id)
    if (!alert) return
    const message = `[${alert.severity.toUpperCase()}] ${alert.type} at ${alert.location}: ${alert.summary}`
    notifyTeamApi(id, message)
      .then(results => {
        const sent = results.filter(r => r.status === "sent" || r.status === "success").length
        window.alert(`Notified ${sent} of ${results.length} device(s).`)
        dismissAlert(id)
      })
      .catch(err => {
        console.error("Failed to notify team:", err)
        window.alert("Failed to send notification. Check console for details.")
      })
  }

  const toggleWatch = (id: string) => {
    setRoutes(prev => {
      const next = prev.map(r => (r.id === id ? { ...r, watched: !r.watched } : r))
      const updated = next.find(r => r.id === id)
      if (updated) {
        setRouteWatchedApi(id, updated.watched).catch(err => console.error("Failed to update watch on server:", err))
      }
      return next
    })
  }

  const applyReroute = (id: number) => {
    setReroutes(prev => prev.map(r => (r.id === id ? { ...r, applied: true } : r)))
    applyRerouteApi(id).catch(err => console.error("Failed to apply reroute on server:", err))
  }

  const dismissReroute = (id: number) => {
    setReroutes(prev => prev.map(r => (r.id === id ? { ...r, dismissed: true } : r)))
    dismissRerouteApi(id).catch(err => console.error("Failed to dismiss reroute on server:", err))
  }

  const generateSuggestions = async () => {
    if (generatingReroutes) return
    setGeneratingReroutes(true)
    try {
      const targets = routes.filter(r => r.risk === "critical" || r.risk === "high")
      const results = await Promise.all(
        targets.map(r => generateReroutesApi(r.id).catch(err => {
          console.error(`Failed to generate reroutes for route ${r.id}:`, err)
          return [] as Awaited<ReturnType<typeof generateReroutesApi>>
        }))
      )
      const newReroutes = results.flat().map(rr => adaptReroute(rr, new Map()))
      setReroutes(prev => {
        const existingIds = new Set(prev.map(r => r.id))
        const deduped = newReroutes.filter(r => !existingIds.has(r.id))
        return [...prev, ...deduped]
      })
    } finally {
      setGeneratingReroutes(false)
    }
  }

  const liveCount = alerts.filter(a => !a.dismissed).length
  const criticalCount = alerts.filter(a => !a.dismissed && a.severity === "critical").length

  const navItems: { icon: string; label: string; id: NavPage; badge?: number }[] = [
    { icon: "◈", label: "Dashboard", id: "dashboard" },
    { icon: "⬡", label: "Live Map", id: "map" },
    { icon: "◇", label: "Route Planner", id: "planner" },
    { icon: "△", label: "Alerts", id: "alerts", badge: criticalCount },
    { icon: "□", label: "Analytics", id: "analytics" },
    { icon: "○", label: "Settings", id: "settings" },
  ]

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "var(--bg)", overflow: "hidden" }}>
      {/* Top Bar */}
      <header
        style={{
          height: 44,
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          padding: "0 16px",
          gap: 12,
          flexShrink: 0,
          background: "var(--panel)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginRight: 4, cursor: "pointer" }} onClick={() => setPage("dashboard")}>
          <div
            style={{
              width: 26,
              height: 26,
              background: "linear-gradient(135deg, #00d4ff 0%, #0066ff 100%)",
              borderRadius: 5,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span style={{ color: "#fff", fontSize: 12, fontWeight: 700, fontFamily: "DM Mono, monospace" }}>U</span>
          </div>
          <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-0.01em" }}>UNILOG</span>
          <span style={{ fontSize: 9, color: "var(--text-3)", letterSpacing: "0.1em", fontWeight: 600 }}>SUPPLY CHAIN INTELLIGENCE</span>
        </div>

        <div style={{ width: 1, height: 20, background: "var(--border)" }} />

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <LiveDot />
          <span className="mono" style={{ fontSize: 10, color: "#22c55e", fontWeight: 500 }}>
            LIVE
          </span>
        </div>

        {criticalCount > 0 && (
          <button
            onClick={() => setPage("alerts")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.25)",
              padding: "3px 9px",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: "#ef4444",
                display: "inline-block",
                animation: "blink 1.2s ease infinite",
              }}
            />
            <span className="mono" style={{ fontSize: 10, color: "#ef4444" }}>
              {liveCount} ACTIVE DISRUPTIONS
            </span>
          </button>
        )}

        {mlRunning && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "3px 8px",
              background: "rgba(0,212,255,0.05)",
              border: "1px solid rgba(0,212,255,0.18)",
              borderRadius: 4,
            }}
          >
            <span style={{ fontSize: 8, color: "var(--primary)", animation: "blink 0.7s infinite" }}>◉</span>
            <span className="mono" style={{ fontSize: 9, color: "var(--primary)" }}>
              ML SCORING
            </span>
          </div>
        )}

        <div style={{ marginLeft: 4, position: "relative" }}>
          {searchOpen ? (
            <input
              autoFocus
              value={searchVal}
              onChange={e => setSearchVal(e.target.value)}
              onBlur={() => {
                setSearchOpen(false)
                setSearchVal("")
              }}
              placeholder="Search routes, ports, alerts…"
              style={{
                width: 220,
                padding: "4px 10px",
                background: "var(--panel-2)",
                border: "1px solid var(--primary)50",
                borderRadius: 4,
                color: "var(--text)",
                fontSize: 11,
                fontFamily: "Outfit, sans-serif",
                outline: "none",
              }}
            />
          ) : (
            <button
              onClick={() => setSearchOpen(true)}
              style={{
                padding: "4px 10px",
                background: "transparent",
                border: "1px solid var(--border)",
                borderRadius: 4,
                color: "var(--text-3)",
                fontSize: 10,
                fontFamily: "DM Mono, monospace",
                cursor: "pointer",
              }}
            >
              ⌕ SEARCH
            </button>
          )}
        </div>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <span className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>
            IST {currentTime}
          </span>
          <button
            style={{
              padding: "4px 10px",
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: 4,
              color: "var(--text-3)",
              fontSize: 10,
              fontFamily: "DM Mono, monospace",
              cursor: "pointer",
            }}
            onClick={() => setPage("settings")}
          >
            ⚙ CONFIG
          </button>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "3px 10px",
              background: "var(--panel-2)",
              borderRadius: 4,
              border: "1px solid var(--border)",
            }}
          >
            <span style={{ fontSize: 11, color: "var(--text-2)" }}>Aparna Dhiraj</span>
            <div
              style={{
                width: 22,
                height: 22,
                borderRadius: "50%",
                background: "linear-gradient(135deg, #00d4ff, #0066ff)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <span style={{ fontSize: 9, fontWeight: 700, color: "#fff" }}>AD</span>
            </div>
          </div>
        </div>
      </header>

      {(dataLoading || dataError) && (
        <div
          style={{
            position: "fixed",
            top: 50,
            right: 16,
            zIndex: 50,
            padding: "6px 12px",
            background: dataError ? "rgba(239,68,68,0.15)" : "rgba(0,212,255,0.1)",
            border: `1px solid ${dataError ? "#ef444460" : "var(--primary)40"}`,
            borderRadius: 4,
            fontSize: 10,
            fontFamily: "DM Mono, monospace",
            color: dataError ? "#ef4444" : "var(--primary)",
          }}
        >
          {dataError ? `Backend error: ${dataError}` : "Loading live data…"}
        </div>
      )}

      {/* Body */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <nav
          style={{
            width: navCollapsed ? 48 : 180,
            borderRight: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            padding: "12px 0",
            gap: 4,
            flexShrink: 0,
            background: "var(--panel)",
            transition: "width 0.15s",
          }}
        >
          <button
            onClick={() => setNavCollapsed(c => !c)}
            title={navCollapsed ? "Expand" : "Collapse"}
            style={{
              alignSelf: navCollapsed ? "center" : "flex-end",
              marginRight: navCollapsed ? 0 : 8,
              marginBottom: 6,
              width: 22,
              height: 22,
              borderRadius: 4,
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--text-3)",
              fontSize: 11,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {navCollapsed ? "»" : "«"}
          </button>
          {navItems.map(item => (
            <button
              key={item.id}
              title={item.label}
              onClick={() => setPage(item.id)}
              style={{
                position: "relative",
                width: navCollapsed ? 36 : "calc(100% - 16px)",
                margin: navCollapsed ? 0 : "0 8px",
                height: 36,
                borderRadius: 6,
                border: "none",
                cursor: "pointer",
                background: page === item.id ? "var(--primary-dim)" : "transparent",
                color: page === item.id ? "var(--primary)" : "var(--text-3)",
                fontSize: 14,
                display: "flex",
                alignItems: "center",
                justifyContent: navCollapsed ? "center" : "flex-start",
                gap: 10,
                padding: navCollapsed ? 0 : "0 10px",
                transition: "all 0.15s",
              }}
            >
              <span>{item.icon}</span>
              {!navCollapsed && <span style={{ fontSize: 11, fontWeight: 500, fontFamily: "Outfit, sans-serif" }}>{item.label}</span>}
              {item.badge != null && item.badge > 0 && (
                <span
                  style={{
                    position: navCollapsed ? "absolute" : "static",
                    top: navCollapsed ? 4 : undefined,
                    right: navCollapsed ? 4 : undefined,
                    marginLeft: navCollapsed ? 0 : "auto",
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    background: "#ef4444",
                    fontSize: 8,
                    fontWeight: 700,
                    fontFamily: "DM Mono, monospace",
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {item.badge}
                </span>
              )}
            </button>
          ))}
        </nav>

        {page === "dashboard" && (
          <DashboardView
            alerts={alerts}
            routes={routes}
            reroutes={reroutes}
            activeAlert={activeAlert}
            setActiveAlert={setActiveAlert}
            onDismissAlert={dismissAlert}
            onToggleWatch={toggleWatch}
            onApplyReroute={applyReroute}
            onDismissReroute={dismissReroute}
            onGenerateReroutes={generateSuggestions}
            generatingReroutes={generatingReroutes}
            mlScores={mlScores}
            mlRunning={mlRunning}
            aiAnalysis={aiAnalysis}
            aiLoading={aiLoading}
            onGenerateAI={generateAI}
            expandedMLId={expandedMLId}
            setExpandedMLId={setExpandedMLId}
          />
        )}
        {page === "map" && <LiveMapPage />}
        {page === "planner" && <RoutePlannerPage />}
        {page === "alerts" && <AlertsPage alerts={alerts} onDismiss={dismissAlert} onNotify={notifyTeam} />}
        {page === "analytics" && <AnalyticsPage />}
        {page === "settings" && <SettingsPage />}
      </div>
    </div>
  )
}