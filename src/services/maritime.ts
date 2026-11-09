// Typed client for the maritime AI endpoints (Aparna's backend).
// Every request/response shape lives here so a schema change is a one-file fix.
// Shapes mirror backend/app/routers/carbon.py, schemas/ml.py, schemas/ai_analysis.py.

import { BACKEND_URL } from "./project44"

// ─── Request shapes ──────────────────────────────────────────────────────────

export type MLFeatures = {
  severity: number
  age_hours: number
  route_overlap: number
  is_chokepoint: number // 0 | 1
  freight_value_musd: number
  vessel_count_nearby: number
  weather_severity: number
  port_congestion_pct: number
}

export type MaritimeRouteInput = {
  route_id: string
  distance_nm: number // nautical miles
  speed_knots: number // knots
  fuel_tonnes_per_day: number // tonnes of fuel per day
}

export type MaritimeRecommendRouteInput = MaritimeRouteInput & {
  ml_features: MLFeatures
}

// ─── Response shapes ─────────────────────────────────────────────────────────

/** POST /ml/predict */
export type MLPredictResponse = {
  score: number // 0-100
  confidence: number | null // null = model has no validated confidence (intentional)
  features: Record<string, number>
}

/** POST /carbon/maritime/compare */
export type MaritimeCompareResponse = {
  routes: {
    route_id: string
    distance_nm: number
    speed_knots: number
    voyage_hours: number
    fuel_tonnes: number
    co2_tonnes: number
  }[]
  lowest_emission_route: string
  emission_unit: string // "tonnes CO2"
  method: string
}

export type SafetyStatus = "eligible" | "high_risk"

export type MaritimeRecommendedRoute = {
  route_id: string
  risk_score: number
  ml_confidence: number | null
  distance_nm: number
  speed_knots: number
  voyage_hours: number
  fuel_tonnes: number
  co2_tonnes: number
  safety_status: SafetyStatus
  carbon_score: number
  combined_score: number
  explanation: string // rule-based template text, NOT LLM output
}

/** POST /carbon/maritime/recommend */
export type MaritimeRecommendResponse = {
  recommended_route: string | null
  lowest_emission_route: string
  safest_route: string
  routes: MaritimeRecommendedRoute[] // ranked best-first by combined_score
  safety_threshold: number
  recommendation_status: "safe_option_available" | "no_eligible_route"
  warning: string | null
  emission_unit: string
  method: string
}

/** POST /ai/risk-analysis */
export type RiskAnalysisRequest = {
  alerts: { severity: string; type: string; location: string; summary: string }[]
  top_location: string | null
  top_score: number | null
  top_confidence: number | null
}

export type AiAnalysisResult =
  | { ok: true; text: string }
  | { ok: false; reason: "not_configured" | "service_error" | "unreachable" }

// ─── Transport ───────────────────────────────────────────────────────────────

export class ApiError extends Error {
  status: number
  constructor(path: string, status: number) {
    super(`${path} failed: ${status}`)
    this.name = "ApiError"
    this.status = status
  }
}

export class SchemaError extends Error {
  constructor(path: string, detail: string) {
    super(`${path} returned an unexpected shape: ${detail}`)
    this.name = "SchemaError"
  }
}

async function post<T>(path: string, body: unknown, timeoutMs = 20000): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${BACKEND_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    if (!res.ok) throw new ApiError(path, res.status)
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

/** Human-readable message for any failure from this module. */
export function describeError(e: unknown): string {
  if (e instanceof DOMException && e.name === "AbortError") return "The request timed out."
  if (e instanceof ApiError) return `The backend returned an error (HTTP ${e.status}).`
  if (e instanceof SchemaError) return "The backend response did not match the expected format."
  return `Could not reach the backend at ${BACKEND_URL}.`
}

// ─── Endpoints ───────────────────────────────────────────────────────────────

export function predictRisk(features: MLFeatures): Promise<MLPredictResponse> {
  return post<MLPredictResponse>("/ml/predict", features)
}

export function compareMaritime(routes: MaritimeRouteInput[]): Promise<MaritimeCompareResponse> {
  return post<MaritimeCompareResponse>("/carbon/maritime/compare", { routes })
}

export async function recommendMaritime(
  routes: MaritimeRecommendRouteInput[]
): Promise<MaritimeRecommendResponse> {
  const path = "/carbon/maritime/recommend"
  const data = await post<MaritimeRecommendResponse>(path, { routes })
  // Light guard so a backend schema change shows a clear error, not a blank screen.
  if (!data || !Array.isArray(data.routes) || data.routes.length === 0)
    throw new SchemaError(path, "routes missing")
  for (const r of data.routes) {
    if (typeof r.route_id !== "string" || typeof r.co2_tonnes !== "number" || typeof r.risk_score !== "number")
      throw new SchemaError(path, "route fields missing")
  }
  return data
}

/**
 * The AI service reports failures as HTTP 200 with the error inside `text`
 * (see backend/app/services/ai_analysis.py), so we classify the text here.
 * Raw error text is never shown to the user.
 */
export async function requestAiAnalysis(req: RiskAnalysisRequest): Promise<AiAnalysisResult> {
  try {
    const { text } = await post<{ text: string }>("/ai/risk-analysis", req, 40000)
    const t = (text ?? "").trim()
    if (!t) return { ok: false, reason: "service_error" }
    if (/^no api key configured/i.test(t)) return { ok: false, reason: "not_configured" }
    if (/^error:/i.test(t) || /^no response\.?$/i.test(t)) return { ok: false, reason: "service_error" }
    return { ok: true, text: t }
  } catch {
    return { ok: false, reason: "unreachable" }
  }
}
