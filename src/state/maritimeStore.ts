// Tiny shared store so the Route Planner and Analytics views read the SAME
// comparison result. No extra dependency: React's useSyncExternalStore.

import { useSyncExternalStore } from "react"
import {
  recommendMaritime,
  describeError,
  type MaritimeRecommendResponse,
  type MaritimeRecommendedRoute,
} from "../services/maritime"
import { DEMO_SNAPSHOTS, type MaritimeScenario } from "../services/maritimeDemo"

export type DataSource = "live" | "demo"

export type MaritimeState = {
  status: "idle" | "loading" | "success" | "error"
  source: DataSource | null
  scenario: MaritimeScenario | null
  data: MaritimeRecommendResponse | null
  baselineId: string | null
  error: string | null
  updatedAt: number | null
}

let state: MaritimeState = {
  status: "idle",
  source: null,
  scenario: null,
  data: null,
  baselineId: null,
  error: null,
  updatedAt: null,
}

const listeners = new Set<() => void>()
let requestId = 0

function setState(patch: Partial<MaritimeState>) {
  state = { ...state, ...patch }
  listeners.forEach(l => l())
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useMaritimeState(): MaritimeState {
  return useSyncExternalStore(subscribe, () => state)
}

/** Non-hook read, for places that only need the latest value once. */
export function getMaritimeState(): MaritimeState {
  return state
}

// ─── Actions ─────────────────────────────────────────────────────────────────

export async function runComparison(scenario: MaritimeScenario) {
  const id = ++requestId
  setState({ status: "loading", scenario, error: null })
  try {
    const data = await recommendMaritime(scenario.routes.map(r => r.input))
    if (id !== requestId) return // a newer request superseded this one
    setState({
      status: "success",
      source: "live",
      data,
      baselineId: scenario.defaultBaselineId,
      error: null,
      updatedAt: Date.now(),
    })
  } catch (e) {
    if (id !== requestId) return
    setState({ status: "error", source: null, data: null, error: describeError(e) })
  }
}

/** Explicit user action only — never applied silently. */
export function loadDemoSnapshot(scenario: MaritimeScenario) {
  const snap = DEMO_SNAPSHOTS[scenario.id]
  if (!snap) return
  requestId++
  setState({
    status: "success",
    source: "demo",
    scenario,
    data: snap,
    baselineId: scenario.defaultBaselineId,
    error: null,
    updatedAt: Date.now(),
  })
}

export function setBaseline(routeId: string) {
  setState({ baselineId: routeId })
}

// ─── Derived values ──────────────────────────────────────────────────────────

export type RiskBand = "low" | "medium" | "high"

/** Same cut-offs as backend/app/services/risk_scoring.py (risk_label). */
export function riskBand(score: number): RiskBand {
  if (score >= 67) return "high"
  if (score >= 34) return "medium"
  return "low"
}

export type RouteRow = MaritimeRecommendedRoute & {
  costPerTeuInr: number | null
  isRecommended: boolean
  isLowestCo2: boolean
  isSafest: boolean // lowest risk score — independent of lowest CO2
  isFastest: boolean
  isBaseline: boolean
  co2DeltaT: number // vs baseline, tonnes (negative = saving)
  co2DeltaPct: number | null
  riskDelta: number // vs baseline, score points
  hoursDelta: number // vs baseline
  band: RiskBand
}

export type ComparisonView = {
  rows: RouteRow[] // ranked best-first, as returned by the backend
  baseline: RouteRow
  recommended: RouteRow | null
  lowestCo2: RouteRow
  safest: RouteRow
  fastest: RouteRow
  maxCo2: number
  aboveThreshold: number
  impliedFactor: number | null // t CO2 per t fuel, computed from the response
}

export function deriveComparison(
  data: MaritimeRecommendResponse,
  scenario: MaritimeScenario,
  baselineId: string | null
): ComparisonView {
  const cost = new Map(scenario.routes.map(r => [r.input.route_id, r.costPerTeuInr]))
  const raw = data.routes
  const base = raw.find(r => r.route_id === baselineId) ?? raw[0]

  const minBy = (k: (r: MaritimeRecommendedRoute) => number) =>
    raw.reduce((a, b) => (k(b) < k(a) ? b : a))
  const lowestCo2Id = data.lowest_emission_route ?? minBy(r => r.co2_tonnes).route_id
  const safestId = data.safest_route ?? minBy(r => r.risk_score).route_id
  const fastestId = minBy(r => r.voyage_hours).route_id

  const rows: RouteRow[] = raw.map(r => ({
    ...r,
    costPerTeuInr: cost.get(r.route_id) ?? null,
    isRecommended: r.route_id === data.recommended_route,
    isLowestCo2: r.route_id === lowestCo2Id,
    isSafest: r.route_id === safestId,
    isFastest: r.route_id === fastestId,
    isBaseline: r.route_id === base.route_id,
    co2DeltaT: r.co2_tonnes - base.co2_tonnes,
    co2DeltaPct: base.co2_tonnes > 0 ? ((r.co2_tonnes - base.co2_tonnes) / base.co2_tonnes) * 100 : null,
    riskDelta: r.risk_score - base.risk_score,
    hoursDelta: r.voyage_hours - base.voyage_hours,
    band: riskBand(r.risk_score),
  }))

  const find = (id: string | null) => rows.find(r => r.route_id === id) ?? null
  const withFuel = raw.find(r => r.fuel_tonnes > 0)

  return {
    rows,
    baseline: find(base.route_id)!,
    recommended: find(data.recommended_route),
    lowestCo2: find(lowestCo2Id)!,
    safest: find(safestId)!,
    fastest: find(fastestId)!,
    maxCo2: Math.max(...raw.map(r => r.co2_tonnes)),
    aboveThreshold: raw.filter(r => r.safety_status === "high_risk").length,
    impliedFactor: withFuel ? withFuel.co2_tonnes / withFuel.fuel_tonnes : null,
  }
}
