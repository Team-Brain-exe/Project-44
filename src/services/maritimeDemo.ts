// Scenario inputs + offline demo snapshot for the maritime comparison.
//
// DEMO DATA: the inputs below are illustrative (round-number distances, one
// vessel profile). The snapshot is a captured response of
// POST /carbon/maritime/recommend for exactly these inputs, used only when the
// user explicitly chooses "Use demo snapshot" because the API is unreachable.
// Replace DEMO_SNAPSHOT with a fresh capture from the deployed API with:
//   curl -s -X POST $BACKEND/carbon/maritime/recommend -H 'Content-Type: application/json' -d @payload.json

import type { MaritimeRecommendResponse, MaritimeRecommendRouteInput, MLFeatures } from "./maritime"

export type ScenarioRoute = {
  input: MaritimeRecommendRouteInput
  /** Illustrative cost from the existing planner demo cards. NOT an API value. */
  costPerTeuInr: number
}

export type MaritimeScenario = {
  id: string
  from: string
  to: string
  title: string
  /** route_id used as the baseline by default (the currently planned route). */
  defaultBaselineId: string
  routes: ScenarioRoute[]
  assumptions: string[]
}

const f = (
  severity: number, age_hours: number, route_overlap: number, is_chokepoint: number,
  freight_value_musd: number, vessel_count_nearby: number, weather_severity: number,
  port_congestion_pct: number
): MLFeatures => ({
  severity, age_hours, route_overlap, is_chokepoint, freight_value_musd,
  vessel_count_nearby, weather_severity, port_congestion_pct,
})

const VESSEL = { speed_knots: 14, fuel_tonnes_per_day: 45 }

export const SCENARIOS: MaritimeScenario[] = [
  {
    id: "jnpt-rotterdam",
    from: "JNPT",
    to: "Rotterdam",
    title: "JNPT \u2192 Rotterdam (Red Sea disruption scenario)",
    defaultBaselineId: "via Suez Canal",
    routes: [
      {
        costPerTeuInr: 3840,
        input: { route_id: "via Suez Canal", distance_nm: 6300, ...VESSEL, ml_features: f(4.5, 36, 0.9, 1, 40, 55, 3, 70) },
      },
      {
        costPerTeuInr: 5080,
        input: { route_id: "via Cape of Good Hope", distance_nm: 10600, ...VESSEL, ml_features: f(1.5, 6, 0.2, 0, 40, 15, 2, 20) },
      },
      {
        costPerTeuInr: 4920,
        input: { route_id: "via Cape + Durban bunker", distance_nm: 10750, ...VESSEL, ml_features: f(2, 8, 0.3, 0, 40, 20, 2.5, 30) },
      },
    ],
    assumptions: [
      "Scenario inputs are illustrative: approximate sea distances and one vessel profile (14 knots, 45 t fuel/day) applied to every route.",
      "Climate-risk inputs (severity, congestion, vessels nearby, etc.) are scenario values supplied to the ML model, not live observations.",
      "Backend holds daily fuel burn constant, so fuel and CO\u2082 scale with voyage time. Speed-dependent fuel curves are not modelled.",
      "Cost per TEU comes from the existing planner demo cards and is not calculated by the API.",
    ],
  },
]

export function getScenario(from: string, to: string): MaritimeScenario | undefined {
  return SCENARIOS.find(s => s.from === from && s.to === to)
}

export const DEMO_SNAPSHOT_META = {
  label: "Demo snapshot",
  detail:
    "Captured from the backend (locally trained model) for the illustrative inputs above. Not live API output.",
}

export const DEMO_SNAPSHOTS: Record<string, MaritimeRecommendResponse> = {
  "jnpt-rotterdam": {
  "recommended_route": "via Cape of Good Hope",
  "lowest_emission_route": "via Suez Canal",
  "safest_route": "via Cape of Good Hope",
  "routes": [
    {
      "route_id": "via Cape of Good Hope",
      "risk_score": 33.3,
      "ml_confidence": null,
      "distance_nm": 10600.0,
      "speed_knots": 14.0,
      "voyage_hours": 757.14,
      "fuel_tonnes": 1419.643,
      "co2_tonnes": 4420.768,
      "safety_status": "eligible",
      "carbon_score": 98.6,
      "combined_score": 52.89,
      "explanation": "Selected as the lowest combined climate-risk and maritime-emissions score among eligible routes."
    },
    {
      "route_id": "via Cape + Durban bunker",
      "risk_score": 36.0,
      "ml_confidence": null,
      "distance_nm": 10750.0,
      "speed_knots": 14.0,
      "voyage_hours": 767.86,
      "fuel_tonnes": 1439.732,
      "co2_tonnes": 4483.326,
      "safety_status": "eligible",
      "carbon_score": 100.0,
      "combined_score": 55.2,
      "explanation": "Eligible alternative route with a higher combined score."
    },
    {
      "route_id": "via Suez Canal",
      "risk_score": 69.7,
      "ml_confidence": null,
      "distance_nm": 6300.0,
      "speed_knots": 14.0,
      "voyage_hours": 450.0,
      "fuel_tonnes": 843.75,
      "co2_tonnes": 2627.438,
      "safety_status": "high_risk",
      "carbon_score": 58.6,
      "combined_score": 66.37,
      "explanation": "Route exceeds the prototype climate-risk threshold and is excluded from automatic recommendation."
    }
  ],
  "safety_threshold": 60.0,
  "recommendation_status": "safe_option_available",
  "warning": null,
  "emission_unit": "tonnes CO2",
  "method": "Prototype safety threshold + 70% ML risk + 30% relative maritime CO2"
},
}
