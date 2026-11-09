
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def make_route(route_id, severity, age_hours, congestion):
    return {
        "route_id": route_id,
        "distance_nm": 1200,
        "speed_knots": 15,
        "fuel_tonnes_per_day": 25,
        "ml_features": {
            "severity": severity,
            "age_hours": age_hours,
            "route_overlap": 0.8,
            "is_chokepoint": 1,
            "freight_value_musd": 20,
            "vessel_count_nearby": 20,
            "weather_severity": severity,
            "port_congestion_pct": congestion,
        },
    }


def test_maritime_recommendation_endpoint():
    response = client.post(
        "/carbon/maritime/recommend",
        json={
            "routes": [
                make_route("A", 2, 2, 10),
                make_route("B", 5, 12, 85),
            ]
        },
    )

    assert response.status_code == 200
    data = response.json()

    assert len(data["routes"]) == 2
    assert data["emission_unit"] == "tonnes CO2"
    assert data["recommended_route"] in ("A", "B", None)
    assert all("explanation" in route for route in data["routes"])


def test_high_risk_routes_not_recommended():
    response = client.post(
        "/carbon/maritime/recommend",
        json={
            "routes": [
                make_route("Cyclone_A", 9, 48, 95),
                make_route("Cyclone_B", 8, 48, 95),
            ]
        },
    )

    assert response.status_code == 200
    data = response.json()

    if data["recommended_route"] is not None:
        selected = next(
            route for route in data["routes"]
            if route["route_id"] == data["recommended_route"]
        )
        assert selected["risk_score"] < data["safety_threshold"]
    else:
        assert data["recommendation_status"] == "no_eligible_route"
        assert data["warning"] is not None


def test_invalid_maritime_recommendation():
    response = client.post(
        "/carbon/maritime/recommend",
        json={
            "routes": [
                make_route("Invalid", 2, 2, 10)
                | {"speed_knots": 0}
            ]
        },
    )

    assert response.status_code == 422
