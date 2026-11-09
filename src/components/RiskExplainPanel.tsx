// Explainable AI panel (Priority 3).
// Three clearly separated layers:
//   1. ML prediction       — numeric output of POST /ml/predict
//   2. Rule-based reasoning — template text from /carbon/maritime/recommend
//   3. AI analysis (LLM)    — generated text from POST /ai/risk-analysis, on demand
// Nothing here invents confidence or feature contributions.

import { useEffect, useState } from "react"
import {
  predictRisk,
  requestAiAnalysis,
  type AiAnalysisResult,
  type MLFeatures,
} from "../services/maritime"
import { riskBand, type DataSource, type RouteRow } from "../state/maritimeStore"
import {
  ActionButton, Badge, BAND_COLOR, BAND_LABEL, Label, Panel, Shimmer, ThresholdBar, fmt,
} from "./maritimeUi"

type MlState =
  | { status: "loading" }
  | { status: "ok"; score: number; confidence: number | null; features: Record<string, number>; via: "ml" | "recommend" | "demo" }

type AiState = { status: "idle" } | { status: "loading" } | { status: "done"; result: AiAnalysisResult }

const FEATURE_LABELS: { key: keyof MLFeatures; label: string; fmt?: (v: number) => string }[] = [
  { key: "severity", label: "Disruption severity" },
  { key: "age_hours", label: "Disruption age", fmt: v => `${fmt(v, 0)} h` },
  { key: "route_overlap", label: "Route overlap (0\u20131)", fmt: v => fmt(v, 2) },
  { key: "is_chokepoint", label: "Chokepoint on route", fmt: v => (v >= 1 ? "Yes" : "No") },
  { key: "freight_value_musd", label: "Freight value", fmt: v => `US$ ${fmt(v, 0)} M` },
  { key: "vessel_count_nearby", label: "Vessels nearby", fmt: v => fmt(v, 0) },
  { key: "weather_severity", label: "Weather severity" },
  { key: "port_congestion_pct", label: "Port congestion", fmt: v => `${fmt(v, 0)} %` },
]

function action(row: RouteRow): { text: string; color: string; tag: string } {
  if (row.safety_status === "high_risk")
    return {
      tag: "AVOID / REVIEW",
      color: "var(--red)",
      text: "Risk score is at or above the prototype safety threshold. Do not select automatically; escalate for manual review.",
    }
  if (row.isRecommended)
    return {
      tag: "PROCEED",
      color: "var(--green)",
      text: "Lowest combined risk\u2013emissions score among routes under the safety threshold.",
    }
  return {
    tag: "ALTERNATIVE",
    color: "var(--amber)",
    text: "Under the safety threshold, but its combined risk\u2013emissions score is higher than the recommended route.",
  }
}

const AI_FALLBACK: Record<"not_configured" | "service_error" | "unreachable", string> = {
  not_configured: "The AI explanation service is not configured on this backend.",
  service_error: "The AI explanation service returned an error.",
  unreachable: "The AI explanation service could not be reached.",
}

export default function RiskExplainPanel({
  row,
  features,
  source,
  threshold,
}: {
  row: RouteRow
  features: MLFeatures | undefined
  source: DataSource
  threshold: number
}) {
  const [ml, setMl] = useState<MlState>({ status: "loading" })
  const [ai, setAi] = useState<AiState>({ status: "idle" })

  // Numeric ML prediction. Live mode asks /ml/predict directly; if that fails we
  // fall back to the score the recommend endpoint already returned.
  useEffect(() => {
    let cancelled = false
    const fallback = (via: "recommend" | "demo"): MlState => ({
      status: "ok",
      score: row.risk_score,
      confidence: row.ml_confidence,
      features: (features ?? {}) as Record<string, number>,
      via,
    })
    if (source === "demo" || !features) {
      setMl(fallback("demo"))
      return
    }
    setMl({ status: "loading" })
    predictRisk(features)
      .then(r => !cancelled && setMl({ status: "ok", score: r.score, confidence: r.confidence, features: r.features, via: "ml" }))
      .catch(() => !cancelled && setMl(fallback("recommend")))
    return () => {
      cancelled = true
    }
  }, [row.route_id, row.risk_score, row.ml_confidence, features, source])

  const runAi = async () => {
    if (ml.status !== "ok") return
    setAi({ status: "loading" })
    const inputs = FEATURE_LABELS.map(f => `${f.label}: ${f.fmt ? f.fmt(ml.features[f.key] ?? 0) : ml.features[f.key]}`).join("; ")
    const result = await requestAiAnalysis({
      alerts: [
        {
          severity: BAND_LABEL[riskBand(ml.score)].toLowerCase(),
          type: "Route risk assessment (scenario)",
          location: row.route_id,
          summary: `Scenario model inputs \u2014 ${inputs}.`,
        },
      ],
      top_location: row.route_id,
      top_score: ml.score,
      top_confidence: ml.confidence, // null when the model provides none — never invented
    })
    setAi({ status: "done", result })
  }

  const act = action(row)
  const band = riskBand(ml.status === "ok" ? ml.score : row.risk_score)

  return (
    <Panel accent={act.color}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Risk explanation: {row.route_id}</span>
        <Badge color={act.color}>{act.tag}</Badge>
        <Badge color="var(--text-2)" title="Derived by fixed rules from the safety threshold and combined score">
          RULE-BASED RECOMMENDATION
        </Badge>
      </div>
      <p style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.55, marginBottom: 16 }}>{act.text}</p>

      <div className="mc-grid-wide">
        {/* ── 1. ML prediction ─────────────────────────────────────────── */}
        <section aria-label="ML prediction">
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
            <Label>ML prediction</Label>
            <Badge color="var(--primary)">NUMERIC MODEL OUTPUT</Badge>
          </div>

          {ml.status === "loading" ? (
            <Shimmer height={96} />
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
                <span className="mono" style={{ fontSize: 28, fontWeight: 500, color: BAND_COLOR[band] }}>
                  {fmt(ml.score, 1)}
                </span>
                <span style={{ fontSize: 11, color: "var(--text-3)" }}>/ 100 climate-risk score</span>
                <Badge color={BAND_COLOR[band]}>{BAND_LABEL[band]} RISK</Badge>
              </div>
              <ThresholdBar score={ml.score} threshold={threshold} color={BAND_COLOR[band]} />
              <div style={{ fontSize: 10, color: "var(--text-3)", margin: "6px 0 10px" }}>
                Tick = prototype safety threshold ({threshold}).{" "}
                {ml.score >= threshold ? "Score is at or above it." : "Score is below it."}
              </div>

              <div style={{ fontSize: 11, marginBottom: 10 }}>
                <span style={{ color: "var(--text-3)" }}>Model confidence: </span>
                {ml.confidence == null ? (
                  <span style={{ color: "var(--text-2)" }} title="The model does not currently provide a validated confidence estimate.">
                    Not available (no validated estimate)
                  </span>
                ) : (
                  <span className="mono">{fmt(ml.confidence, 1)}</span>
                )}
              </div>

              {ml.via !== "ml" && (
                <div style={{ marginBottom: 10 }}>
                  <Badge color="var(--amber)">
                    {ml.via === "demo" ? "DEMO SNAPSHOT SCORE" : "ML ENDPOINT UNAVAILABLE \u2014 SHOWING RECOMMEND-ENDPOINT SCORE"}
                  </Badge>
                </div>
              )}

              <Label>Model inputs</Label>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <tbody>
                  {FEATURE_LABELS.map(f => {
                    const v = ml.features[f.key]
                    return (
                      <tr key={f.key} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td style={{ padding: "4px 0", color: "var(--text-2)" }}>{f.label}</td>
                        <td className="mono" style={{ padding: "4px 0", textAlign: "right" }}>
                          {v == null ? "\u2014" : f.fmt ? f.fmt(v) : fmt(v, 1)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 6, lineHeight: 1.5 }}>
                These are the values the model received. They are inputs, not per-prediction feature contributions,
                which the API does not provide.
              </div>
            </>
          )}
        </section>

        {/* ── 2 & 3. Explanations ──────────────────────────────────────── */}
        <section aria-label="Explanations" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
              <Label>Route reasoning</Label>
              <Badge color="var(--text-2)">RULE-BASED, NOT AI-GENERATED</Badge>
            </div>
            <p style={{ fontSize: 12, lineHeight: 1.55, color: "var(--text)" }}>{row.explanation}</p>
            <div className="mono" style={{ fontSize: 10, color: "var(--text-3)", marginTop: 6 }}>
              combined score {fmt(row.combined_score, 2)} &middot; carbon score {fmt(row.carbon_score, 1)}
            </div>
          </div>

          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
              <Label>AI analysis</Label>
              <Badge color="var(--amber)">LLM-GENERATED TEXT</Badge>
            </div>

            {ai.status === "idle" && (
              <>
                <p style={{ fontSize: 11, color: "var(--text-3)", lineHeight: 1.5, marginBottom: 8 }}>
                  Optional narrative from the backend language model. It is generated text and is separate from the
                  numeric ML score above.
                </p>
                <ActionButton onClick={runAi} disabled={ml.status !== "ok"}>
                  GENERATE AI ANALYSIS
                </ActionButton>
              </>
            )}
            {ai.status === "loading" && <Shimmer height={64} />}
            {ai.status === "done" && ai.result.ok && (
              <>
                <p style={{ fontSize: 12, lineHeight: 1.6 }}>{ai.result.text}</p>
                <div style={{ marginTop: 8 }}>
                  <ActionButton tone="muted" onClick={runAi}>
                    REGENERATE
                  </ActionButton>
                </div>
              </>
            )}
            {ai.status === "done" && !ai.result.ok && (
              <div
                role="status"
                style={{
                  fontSize: 11,
                  lineHeight: 1.55,
                  padding: "10px 12px",
                  borderRadius: 6,
                  border: "1px dashed var(--border-light)",
                  color: "var(--text-2)",
                }}
              >
                {AI_FALLBACK[ai.result.reason]} The ML score, safety status and rule-based reasoning above are unaffected.
                <div style={{ marginTop: 8 }}>
                  <ActionButton tone="muted" onClick={runAi}>
                    RETRY
                  </ActionButton>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </Panel>
  )
}
