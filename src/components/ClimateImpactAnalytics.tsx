// Climate impact analytics (Priority 2).
// Reads the same comparison as the Route Planner, so it updates whenever the
// comparison or its baseline changes. Everything here is a SCENARIO ESTIMATE,
// not historical or live operational data.

import { useMemo } from "react"
import {
  deriveComparison,
  setBaseline,
  useMaritimeState,
  type ComparisonView,
  type RouteRow,
} from "../state/maritimeStore"
import { Badge, BAND_COLOR, CO2, Label, Panel, Shimmer, fmt, signed } from "./maritimeUi"

function StatCard({
  label, value, sub, color = "var(--text)",
}: { label: string; value: string; sub: string; color?: string }) {
  return (
    <Panel style={{ padding: 14, minWidth: 0 }}>
      <Label>{label}</Label>
      <div className="mono" style={{ fontSize: 18, fontWeight: 500, color, overflowWrap: "anywhere", lineHeight: 1.25 }}>
        {value}
      </div>
      <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 6, lineHeight: 1.5 }}>{sub}</div>
    </Panel>
  )
}

function BarChart({
  title, unit, rows, value, max, color, threshold, ariaUnit,
}: {
  title: string
  unit: string
  rows: RouteRow[]
  value: (r: RouteRow) => number
  max: number
  color: (r: RouteRow) => string
  threshold?: number
  ariaUnit: string
}) {
  return (
    <Panel style={{ minWidth: 0 }}>
      <div style={{ fontSize: 12, fontWeight: 600 }}>{title}</div>
      <div style={{ fontSize: 10, color: "var(--text-3)", marginBottom: 12 }}>{unit}</div>
      <div role="list" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {rows.map(r => {
          const v = value(r)
          return (
            <div key={r.route_id} role="listitem" aria-label={`${r.route_id}: ${fmt(v, 1)} ${ariaUnit}`}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 11, marginBottom: 4 }}>
                <span style={{ overflowWrap: "anywhere" }}>
                  {r.route_id}
                  {r.isBaseline && <span style={{ color: "var(--text-3)" }}> (baseline)</span>}
                </span>
                <span className="mono" style={{ whiteSpace: "nowrap" }}>{fmt(v, 1)}</span>
              </div>
              <div style={{ position: "relative", height: 8, background: "#1a2d42", borderRadius: 3 }}>
                <div
                  style={{
                    width: `${max > 0 ? Math.max(1, (v / max) * 100) : 0}%`,
                    height: "100%",
                    background: color(r),
                    borderRadius: 3,
                    outline: r.isBaseline ? "1px solid var(--text-2)" : "none",
                    outlineOffset: 1,
                  }}
                />
                {threshold != null && (
                  <div
                    title={`Safety threshold ${threshold}`}
                    style={{ position: "absolute", left: `${(threshold / max) * 100}%`, top: -3, bottom: -3, width: 1.5, background: "var(--text)", opacity: 0.7 }}
                  />
                )}
              </div>
            </div>
          )
        })}
      </div>
      {threshold != null && (
        <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 12 }}>Vertical tick = prototype safety threshold ({threshold}).</div>
      )}
    </Panel>
  )
}

function Content({ view, threshold, source }: { view: ComparisonView; threshold: number; source: "live" | "demo" | null }) {
  const { rows, baseline, recommended } = view
  const noRec = !recommended
  const sameAsBase = recommended?.isBaseline ?? false

  const riskVal = noRec ? "\u2014" : `${signed(recommended.riskDelta)} pts`
  const riskSub = noRec
    ? "No route is under the safety threshold."
    : sameAsBase
      ? "The baseline is itself the recommended route."
      : `Baseline ${fmt(baseline.risk_score)} \u2192 recommended ${fmt(recommended.risk_score)} (ML risk score, 0\u2013100).`

  const co2Val = noRec ? "\u2014" : `${signed(recommended.co2DeltaT)} t`
  const co2Sub = noRec
    ? "No recommended route to compare."
    : sameAsBase
      ? "The baseline is itself the recommended route."
      : `${signed(recommended.co2DeltaT * 1000, 0)} kg${recommended.co2DeltaPct != null ? ` \u00B7 ${signed(recommended.co2DeltaPct)}%` : ""} vs baseline (estimated ${CO2}).`
  const co2Color = noRec || sameAsBase ? "var(--text)" : recommended.co2DeltaT <= 0 ? "var(--green)" : "var(--amber)"
  const riskColor = noRec || sameAsBase ? "var(--text)" : recommended.riskDelta <= 0 ? "var(--green)" : "var(--red)"

  return (
    <>
      <div className="mc-grid-stats">
        <StatCard
          label="Recommended route"
          value={recommended ? recommended.route_id : "None eligible"}
          sub={recommended ? `Combined score ${fmt(recommended.combined_score, 2)} (lower is better).` : "Manual review required."}
          color={recommended ? "var(--green)" : "var(--red)"}
        />
        <StatCard label="Risk change vs baseline" value={riskVal} sub={riskSub} color={riskColor} />
        <StatCard label={`Est. ${CO2} difference`} value={co2Val} sub={co2Sub} color={co2Color} />
        <StatCard
          label="Routes above threshold"
          value={`${view.aboveThreshold} of ${rows.length}`}
          sub={`Safety threshold ${threshold} (prototype assumption).`}
          color={view.aboveThreshold > 0 ? "var(--amber)" : "var(--green)"}
        />
      </div>

      <div className="mc-grid-charts">
        <BarChart
          title="ML climate-risk score by route"
          unit={"Score, 0\u2013100 (higher = riskier)"}
          rows={rows}
          value={r => r.risk_score}
          max={100}
          threshold={threshold}
          color={r => (r.safety_status === "high_risk" ? "var(--red)" : BAND_COLOR[r.band])}
          ariaUnit="out of 100"
        />
        <BarChart
          title={`Estimated ${CO2} by route`}
          unit={"Tonnes CO\u2082, estimated"}
          rows={rows}
          value={r => r.co2_tonnes}
          max={view.maxCo2}
          color={r => (r.isLowestCo2 ? "#2dd4bf" : "var(--primary)")}
          ariaUnit="tonnes CO2 (estimated)"
        />
      </div>

      <div style={{ fontSize: 10, color: "var(--text-3)", lineHeight: 1.6 }}>
        Scenario estimate from {source === "demo" ? "a captured demo snapshot" : "the live prototype API"}
        {" "}for the illustrative inputs in the Route Planner. It is not historical or live operational data,
        and {CO2} values are estimates, not measurements.
      </div>
    </>
  )
}

export default function ClimateImpactAnalytics() {
  const s = useMaritimeState()
  const view = useMemo(
    () => (s.data && s.scenario ? deriveComparison(s.data, s.scenario, s.baselineId) : null),
    [s.data, s.scenario, s.baselineId]
  )

  return (
    <section aria-label="Climate impact scenario" style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 28 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <h3 style={{ fontSize: 14, fontWeight: 700 }}>Climate impact</h3>
        <Badge color="var(--amber)" title="Modelled scenario, not historical or live data">SCENARIO ESTIMATE</Badge>
        {s.status === "success" && s.source === "live" && <Badge color="var(--green)">LIVE API</Badge>}
        {s.status === "success" && s.source === "demo" && <Badge color="var(--amber)">DEMO SNAPSHOT</Badge>}
        {view && s.scenario && (
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
            <label htmlFor="ci-baseline" style={{ fontSize: 10, color: "var(--text-3)" }}>Baseline</label>
            <select
              id="ci-baseline"
              value={view.baseline.route_id}
              onChange={e => setBaseline(e.target.value)}
              style={{ padding: "4px 8px", background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)", fontSize: 11, fontFamily: "Outfit, sans-serif" }}
            >
              {view.rows.map(r => <option key={r.route_id} value={r.route_id}>{r.route_id}</option>)}
            </select>
          </div>
        )}
      </div>
      {s.scenario && <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: -6 }}>{s.scenario.title}</div>}

      {s.status === "loading" && <Shimmer height={110} />}
      {s.status === "error" && (
        <Panel style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.6 }}>
          The route comparison failed ({s.error}) so there is nothing to summarise yet. Open Route Planner to retry.
        </Panel>
      )}
      {s.status === "idle" && (
        <Panel style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.6 }}>
          No comparison has been run yet. Open Route Planner, choose JNPT &rarr; Rotterdam and click
          Calculate Routes. The impact summary appears here.
        </Panel>
      )}
      {view && s.data && <Content view={view} threshold={s.data.safety_threshold} source={s.source} />}
    </section>
  )
}
