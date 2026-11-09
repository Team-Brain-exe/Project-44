// Carbon-aware route comparison (Priority 1) for the Route Planner.
// Uses POST /carbon/maritime/recommend. All CO2 / fuel figures are ESTIMATES
// from a prototype model and declared assumptions; they are never measurements.

import { useEffect, useMemo, useState } from "react"
import {
  deriveComparison,
  loadDemoSnapshot,
  runComparison,
  setBaseline,
  useMaritimeState,
  type RouteRow,
} from "../state/maritimeStore"
import { DEMO_SNAPSHOT_META, getScenario, DEMO_SNAPSHOTS } from "../services/maritimeDemo"
import RiskExplainPanel from "./RiskExplainPanel"
import {
  ActionButton, Badge, Banner, BAND_COLOR, CO2, Label, Panel, Shimmer, ThresholdBar, fmt, signed,
} from "./maritimeUi"

function Metric({ label, value, unit, sub }: { label: string; value: string; unit?: string; sub?: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 9, color: "var(--text-3)", marginBottom: 2 }}>{label}</div>
      <div className="mono" style={{ fontSize: 13, fontWeight: 500, overflowWrap: "anywhere" }}>
        {value}
        {unit && <span style={{ fontSize: 9, color: "var(--text-3)", marginLeft: 3 }}>{unit}</span>}
      </div>
      {sub && <div style={{ fontSize: 9, color: "var(--text-3)" }}>{sub}</div>}
    </div>
  )
}

function Delta({ label, value, good }: { label: string; value: string; good: boolean | null }) {
  const color = good == null ? "var(--text-2)" : good ? "var(--green)" : "var(--amber)"
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 11 }}>
      <span style={{ color: "var(--text-3)" }}>{label}</span>
      <span className="mono" style={{ color, textAlign: "right" }}>{value}</span>
    </div>
  )
}

function RouteCard({
  row,
  threshold,
  selected,
  onSelect,
}: {
  row: RouteRow
  threshold: number
  selected: boolean
  onSelect: () => void
}) {
  const above = row.safety_status === "high_risk"
  const color = above ? "var(--red)" : BAND_COLOR[row.band]
  const co2Word =
    row.co2DeltaT < 0 ? `saves ${fmt(Math.abs(row.co2DeltaT))} t` : `adds ${fmt(row.co2DeltaT)} t`
  const days = row.voyage_hours / 24

  return (
    <div
      style={{
        background: "var(--panel)",
        border: `1px solid ${selected ? "var(--primary)" : row.isRecommended ? "color-mix(in srgb, var(--green) 40%, transparent)" : "var(--border)"}`,
        borderLeft: `2px solid ${color}`,
        borderRadius: 6,
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        minWidth: 0,
      }}
    >
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, overflowWrap: "anywhere" }}>{row.route_id}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {row.isRecommended && <Badge color="var(--green)">RECOMMENDED</Badge>}
          {row.isSafest && <Badge color="var(--primary)" title="Lowest ML risk score">SAFEST</Badge>}
          {row.isLowestCo2 && <Badge color="#2dd4bf" title="Lowest estimated CO₂">LOWEST {CO2}</Badge>}
          {row.isFastest && <Badge color="var(--text-2)" title="Shortest voyage time">FASTEST</Badge>}
          {row.isBaseline && <Badge color="var(--text)" title="Savings are measured against this route">BASELINE</Badge>}
        </div>
      </div>

      <div className="mc-metrics">
        <Metric label="Distance" value={fmt(row.distance_nm, 0)} unit="nm" />
        <Metric label="Voyage" value={fmt(days, 1)} unit="days" sub={`${fmt(row.voyage_hours, 0)} h`} />
        <Metric label="Cost (demo)" value={row.costPerTeuInr != null ? `\u20B9${fmt(row.costPerTeuInr, 0)}` : "\u2014"} unit="/TEU" />
        <Metric label="Est. fuel" value={fmt(row.fuel_tonnes, 1)} unit="t" />
        <Metric label={`Est. ${CO2}`} value={fmt(row.co2_tonnes, 1)} unit="t" />
        <Metric label="ML risk" value={fmt(row.risk_score, 1)} unit="/100" />
      </div>

      <div>
        <ThresholdBar score={row.risk_score} threshold={threshold} color={color} />
        <div style={{ fontSize: 10, marginTop: 6, color }}>
          {above ? `Above safety threshold (${threshold})` : `Under safety threshold (${threshold})`}
        </div>
      </div>

      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
        {row.isBaseline ? (
          <div style={{ fontSize: 11, color: "var(--text-3)" }}>Reference route for the comparison.</div>
        ) : (
          <>
            <Delta
              label={`${CO2} vs baseline`}
              value={`${co2Word}${row.co2DeltaPct != null ? ` (${signed(row.co2DeltaPct)}%)` : ""}`}
              good={row.co2DeltaT < 0}
            />
            <Delta label="Risk vs baseline" value={`${signed(row.riskDelta)} pts`} good={row.riskDelta < 0} />
            <Delta label="Voyage vs baseline" value={`${signed(row.hoursDelta / 24)} days`} good={row.hoursDelta < 0} />
          </>
        )}
      </div>

      <div style={{ marginTop: "auto" }}>
        <ActionButton onClick={onSelect} active={selected}>
          {selected ? "\u2713 SHOWING RISK DETAILS" : "RISK DETAILS"}
        </ActionButton>
      </div>
    </div>
  )
}

export default function MaritimeComparison({ from, to }: { from: string; to: string }) {
  const scenario = getScenario(from, to)
  const s = useMaritimeState()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    if (!scenario) return
    if (s.scenario?.id !== scenario.id || s.status === "idle") runComparison(scenario)
    // run once per scenario; the store ignores superseded requests
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario?.id])

  const view = useMemo(
    () => (s.data && s.scenario ? deriveComparison(s.data, s.scenario, s.baselineId) : null),
    [s.data, s.scenario, s.baselineId]
  )

  const header = (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <h3 style={{ fontSize: 14, fontWeight: 700 }}>Carbon-aware route comparison</h3>
      <Badge color="var(--amber)" title="Values are model estimates, not measured emissions">ESTIMATED</Badge>
      {s.status === "success" && s.source === "live" && <Badge color="var(--green)">LIVE API</Badge>}
      {s.status === "success" && s.source === "demo" && <Badge color="var(--amber)">DEMO SNAPSHOT</Badge>}
      {scenario && s.status === "success" && (
        <div style={{ marginLeft: "auto" }}>
          <ActionButton tone="muted" onClick={() => runComparison(scenario)}>REFRESH</ActionButton>
        </div>
      )}
    </div>
  )

  if (!scenario) {
    return (
      <div style={{ marginTop: 28, display: "flex", flexDirection: "column", gap: 12 }}>
        {header}
        <Panel style={{ color: "var(--text-2)", fontSize: 12, lineHeight: 1.6 }}>
          No emissions comparison scenario is defined for {from} &rarr; {to} yet. This demo includes the
          JNPT &rarr; Rotterdam scenario; select it to compare routes.
        </Panel>
      </div>
    )
  }

  const body = () => {
    if (s.status === "loading" || (s.status === "idle")) {
      return (
        <div className="mc-grid" aria-busy="true" aria-label="Loading route comparison">
          <Shimmer height={300} /><Shimmer height={300} /><Shimmer height={300} />
        </div>
      )
    }
    if (s.status === "error" || !view || !s.data) {
      const canDemo = !!DEMO_SNAPSHOTS[scenario.id]
      return (
        <Banner tone="error">
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Route comparison is unavailable.</div>
          <div style={{ marginBottom: 10 }}>{s.error ?? "No data was returned."}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <ActionButton onClick={() => runComparison(scenario)}>RETRY</ActionButton>
            {canDemo && (
              <ActionButton tone="muted" onClick={() => loadDemoSnapshot(scenario)}>USE DEMO SNAPSHOT</ActionButton>
            )}
          </div>
        </Banner>
      )
    }

    const data = s.data
    const rec = view.recommended
    const effectiveId =
      view.rows.find(r => r.route_id === selectedId)?.route_id ?? (rec ?? view.safest).route_id
    const selected = view.rows.find(r => r.route_id === effectiveId)!
    const selectedInput = s.scenario!.routes.find(r => r.input.route_id === effectiveId)?.input

    const tradeoff =
      rec && rec.route_id !== view.lowestCo2.route_id
        ? (() => {
            const extra = rec.co2_tonnes - view.lowestCo2.co2_tonnes
            const pct = view.lowestCo2.co2_tonnes > 0 ? (extra / view.lowestCo2.co2_tonnes) * 100 : null
            const why =
              view.lowestCo2.safety_status === "high_risk"
                ? ` but its ML risk score (${fmt(view.lowestCo2.risk_score)}) is at or above the safety threshold (${data.safety_threshold})`
                : ""
            return `The lowest-${CO2} route is ${view.lowestCo2.route_id}${why}. Choosing ${rec.route_id} instead adds an estimated ${fmt(extra)} t ${CO2}${pct != null ? ` (${signed(pct)}%)` : ""}.`
          })()
        : null

    return (
      <>
        {s.source === "demo" && (
          <Banner tone="warn">
            <strong>{DEMO_SNAPSHOT_META.label}.</strong> {DEMO_SNAPSHOT_META.detail}
          </Banner>
        )}

        {data.warning && (
          <Banner tone="error">
            <strong>No safe option.</strong> {data.warning}
          </Banner>
        )}

        <Panel accent={rec ? "var(--green)" : "var(--red)"}>
          <Label>Recommendation</Label>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
            {rec ? rec.route_id : "No route is under the safety threshold"}
          </div>
          <p style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.6 }}>
            {rec
              ? `Lowest combined risk\u2013emissions score (${fmt(rec.combined_score, 2)}) among routes under the risk threshold.`
              : "Every route is at or above the prototype risk threshold, so none is recommended automatically."}{" "}
            {tradeoff}
          </p>
          <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 8, lineHeight: 1.5 }}>
            Ranking: {data.method}. The threshold and weights are prototype assumptions, not validated policy.
          </div>
        </Panel>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <label htmlFor="mc-baseline" style={{ fontSize: 11, color: "var(--text-3)" }}>
            Baseline route for savings
          </label>
          <select
            id="mc-baseline"
            value={view.baseline.route_id}
            onChange={e => setBaseline(e.target.value)}
            style={{
              padding: "5px 8px", background: "var(--panel)", border: "1px solid var(--border)",
              borderRadius: 4, color: "var(--text)", fontSize: 11, fontFamily: "Outfit, sans-serif",
            }}
          >
            {view.rows.map(r => (
              <option key={r.route_id} value={r.route_id}>{r.route_id}</option>
            ))}
          </select>
          <span style={{ fontSize: 10, color: "var(--text-3)" }}>
            Default: the currently planned route.
          </span>
        </div>

        <div className="mc-grid">
          {view.rows.map(r => (
            <RouteCard
              key={r.route_id}
              row={r}
              threshold={data.safety_threshold}
              selected={r.route_id === effectiveId}
              onSelect={() => setSelectedId(r.route_id)}
            />
          ))}
        </div>

        <details style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 6, padding: "10px 14px" }}>
          <summary style={{ cursor: "pointer", fontSize: 11, fontWeight: 600 }}>
            Units and assumptions
          </summary>
          <ul style={{ margin: "10px 0 0 16px", fontSize: 11, color: "var(--text-2)", lineHeight: 1.7 }}>
            <li>Units: distance in nautical miles (nm), fuel and {CO2} in tonnes (t), voyage time in hours/days.</li>
            <li>Method: {data.method}.</li>
            {view.impliedFactor != null && (
              <li>Emission factor implied by the response: {fmt(view.impliedFactor, 3)} t {CO2} per tonne of fuel (illustrative tank-to-wake, not a measurement).</li>
            )}
            {s.scenario!.assumptions.map(a => <li key={a}>{a}</li>)}
            <li>All {CO2} and fuel values are estimates. They are not measured emissions.</li>
          </ul>
        </details>

        <RiskExplainPanel
          key={`${effectiveId}-${s.source}`}
          row={selected}
          features={selectedInput?.ml_features}
          source={s.source ?? "live"}
          threshold={data.safety_threshold}
        />
      </>
    )
  }

  return (
    <div style={{ marginTop: 28, display: "flex", flexDirection: "column", gap: 14 }}>
      {header}
      <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: -6 }}>{scenario.title}</div>
      {body()}
    </div>
  )
}
