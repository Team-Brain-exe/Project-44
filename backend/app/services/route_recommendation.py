
from app.ml.model import predict
from app.services.carbon import estimate_carbon

# Prototype safety threshold, not an operational standard.
MAX_ACCEPTABLE_RISK = 60.0


def recommend_routes(routes: list[dict]) -> dict:
    if not routes:
        raise ValueError("At least one route is required")

    results = []

    for route in routes:
        ml_result = predict(route["ml_features"])

        carbon = estimate_carbon(
            distance_km=route["distance_km"],
            fuel_litres_per_100km=route["fuel_litres_per_100km"],
        )

        risk_score = ml_result["score"]

        results.append({
            "route_id": route["route_id"],
            "risk_score": risk_score,
            "ml_confidence": ml_result["confidence"],
            "fuel_litres": carbon.fuel_litres,
            "co2_kg": carbon.co2_kg,
            "safety_status": (
                "eligible"
                if risk_score < MAX_ACCEPTABLE_RISK
                else "high_risk"
            ),
        })

    max_co2 = max(r["co2_kg"] for r in results)

    for route in results:
        carbon_score = (
            route["co2_kg"] / max_co2 * 100
            if max_co2 > 0 else 0
        )

        route["carbon_score"] = round(carbon_score, 2)
        route["combined_score"] = round(
            0.7 * route["risk_score"]
            + 0.3 * carbon_score,
            2,
        )

    ranked = sorted(
        results,
        key=lambda r: (
            r["combined_score"],
            r["risk_score"],
            r["co2_kg"],
        ),
    )

    eligible = [
        route for route in ranked
        if route["safety_status"] == "eligible"
    ]

    recommended = eligible[0] if eligible else None

    return {
        "recommended_route": (
            recommended["route_id"] if recommended else None
        ),
        "lowest_emission_route": min(
            results, key=lambda r: r["co2_kg"]
        )["route_id"],
        "safest_route": min(
            results, key=lambda r: r["risk_score"]
        )["route_id"],
        "routes": ranked,
        "safety_threshold": MAX_ACCEPTABLE_RISK,
        "recommendation_status": (
            "safe_option_available"
            if recommended
            else "no_eligible_route"
        ),
        "warning": (
            None if recommended
            else "All routes exceed the prototype climate-risk threshold. "
                 "Review conditions before proceeding."
        ),
        "method": "Safety threshold + 70% ML risk + 30% relative CO2",
    }
