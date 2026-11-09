
from app.ml.model import predict
from app.services.carbon import estimate_maritime_carbon
from app.services.route_recommendation import MAX_ACCEPTABLE_RISK


def recommend_maritime_routes(routes: list[dict]) -> dict:
    if not routes:
        raise ValueError("At least one route is required")

    results = []

    for route in routes:
        ml_result = predict(route["ml_features"])

        carbon = estimate_maritime_carbon(
            distance_nm=route["distance_nm"],
            speed_knots=route["speed_knots"],
            fuel_tonnes_per_day=route["fuel_tonnes_per_day"],
        )

        risk_score = ml_result["score"]

        results.append({
            "route_id": route["route_id"],
            "risk_score": risk_score,
            "ml_confidence": ml_result["confidence"],
            "distance_nm": carbon.distance_nm,
            "speed_knots": carbon.speed_knots,
            "voyage_hours": carbon.voyage_hours,
            "fuel_tonnes": carbon.fuel_tonnes,
            "co2_tonnes": carbon.co2_tonnes,
            "safety_status": (
                "eligible"
                if risk_score < MAX_ACCEPTABLE_RISK
                else "high_risk"
            ),
        })

    max_co2 = max(r["co2_tonnes"] for r in results)

    for route in results:
        carbon_score = (
            route["co2_tonnes"] / max_co2 * 100
            if max_co2 > 0 else 0
        )

        route["carbon_score"] = round(carbon_score, 2)
        route["combined_score"] = round(
            0.7 * route["risk_score"] + 0.3 * carbon_score,
            2,
        )

    ranked = sorted(
        results,
        key=lambda r: (
            r["combined_score"],
            r["risk_score"],
            r["co2_tonnes"],
        ),
    )

    eligible = [
        route for route in ranked
        if route["safety_status"] == "eligible"
    ]

    recommended = eligible[0] if eligible else None

    for route in ranked:
        if route["safety_status"] == "high_risk":
            route["explanation"] = (
                "Route exceeds the prototype climate-risk threshold "
                "and is excluded from automatic recommendation."
            )
        elif recommended and route["route_id"] == recommended["route_id"]:
            route["explanation"] = (
                "Selected as the lowest combined climate-risk and "
                "maritime-emissions score among eligible routes."
            )
        else:
            route["explanation"] = (
                "Eligible alternative route with a higher combined score."
            )

    return {
        "recommended_route": (
            recommended["route_id"] if recommended else None
        ),
        "lowest_emission_route": min(
            results, key=lambda r: r["co2_tonnes"]
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
                 "Manual review is required."
        ),
        "emission_unit": "tonnes CO2",
        "method": (
            "Prototype safety threshold + 70% ML risk "
            "+ 30% relative maritime CO2"
        ),
    }
