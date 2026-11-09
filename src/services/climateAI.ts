import { BACKEND_URL } from "./project44"

export type MLFeatures = {
  severity: number
  age_hours: number
  route_overlap: number
  is_chokepoint: number
  freight_value_musd: number
  vessel_count_nearby: number
  weather_severity: number
  port_congestion_pct: number
}

export type MaritimeRouteInput = {
  route_id: string
  distance_nm: number
  speed_knots: number
  fuel_tonnes_per_day: number
  ml_features: MLFeatures
}

export type MaritimeRouteResult = {
  route_id: string
  risk_score: number
  ml_risk_score: number
  risk_source: "ml_prediction" | "simulated_climate_event"
  co2_tonnes: number
  voyage_hours: number
  safety_status: "eligible" | "high_risk"
  combined_score: number
  explanation: string
}

export type MaritimeRecommendation = {
  recommended_route: string | null
  lowest_emission_route: string
  safest_route: string
  routes: MaritimeRouteResult[]
  safety_threshold: number
  recommendation_status: string
  warning: string | null
}

export type ClimateSimulation = {
  simulated: boolean
  scenario: string
  risk_before: { score: number; risk: string }
  risk_after: { score: number; risk: string }
  alert: { id: number; status: string } | null
}

async function api<T>(
  path: string,
  method: "GET" | "POST",
  body?: unknown
): Promise<T> {
  const response = await fetch(`${BACKEND_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(`${path}: ${response.status} ${message}`)
  }

  return response.json() as Promise<T>
}

export function simulateCyclone(routeId: number) {
  return api<ClimateSimulation>("/simulation/climate", "POST", {
    scenario: "severe",
    route_id: routeId,
    event_type: "cyclone",
  })
}

export function resetClimateSimulation() {
  return api<{
    simulated: boolean
    reset: boolean
    events_cleared: number
    alerts_removed: number
  }>("/simulation/reset", "POST")
}

export function getSimulationStatus() {
  return api<{
    simulated: boolean
    active_events: Array<{
      route_id: number
      event_type: string
      risk_before: number
      risk_after: number
    }>
  }>("/simulation/status", "GET")
}

export function getMaritimeRecommendation(routes: MaritimeRouteInput[]) {
  return api<MaritimeRecommendation>(
    "/carbon/maritime/recommend",
    "POST",
    { routes }
  )
}
export type BackendRoute = {
  id: number
  origin: string
  destination: string
  via: string
  risk: string
  score: number
  status: string
  freight: number
  delay: number
  watched: boolean
}

export function getAvailableRoutes() {
  return api<BackendRoute[]>("/routes", "GET")
}