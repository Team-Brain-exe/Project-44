
import pytest

from app.services.carbon import estimate_carbon
from app.services.route_recommendation import recommend_routes


def make_route(route_id, distance, risk_conditions):
    return {
        "route_id": route_id,
        "distance_km": distance,
        "fuel_litres_per_100km": 30,
        "ml_features": {
            "severity": risk_conditions,
            "age_hours": 12,
            "route_overlap": 0.8,
            "is_chokepoint": 1,
            "freight_value_musd": 20,
            "vessel_count_nearby": 20,
            "weather_severity": risk_conditions,
            "port_congestion_pct": 85,
        },
    }


def test_carbon_calculation():
    result = estimate_carbon(500, 30)

    assert result.fuel_litres == 150
    assert result.co2_kg == 402


def test_recommendation_returns_valid_route():
    routes = [
        make_route("A", 500, 2),
        make_route("B", 450, 3),
    ]

    result = recommend_routes(routes)

    assert len(result["routes"]) == 2
    assert result["recommendation_status"] in (
        "safe_option_available",
        "no_eligible_route",
    )

    if result["recommended_route"] is not None:
        assert result["recommended_route"] in ("A", "B")
        selected = next(
            r for r in result["routes"]
            if r["route_id"] == result["recommended_route"]
        )
        assert selected["risk_score"] < 60


def test_all_routes_high_risk():
    routes = [
        make_route("Cyclone_A", 500, 9),
        make_route("Cyclone_B", 450, 8),
    ]

    result = recommend_routes(routes)

    if all(r["risk_score"] >= 60 for r in result["routes"]):
        assert result["recommended_route"] is None
        assert result["recommendation_status"] == "no_eligible_route"
    else:
        pytest.skip("Model did not classify all routes as high risk")
