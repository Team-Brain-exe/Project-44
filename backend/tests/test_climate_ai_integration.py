import pytest

from tests.test_simulation import client  # Reuse isolated SQLite fixture


ML_FEATURES = {
    "severity": 1,
    "age_hours": 24,
    "route_overlap": 0.1,
    "is_chokepoint": 0,
    "freight_value_musd": 15,
    "vessel_count_nearby": 1,
    "weather_severity": 0,
    "port_congestion_pct": 15,
}


def recommend(client):
    response = client.post(
        "/carbon/maritime/recommend",
        json={
            "routes": [
                {
                    "route_id": "3",
                    "distance_nm": 8500,
                    "speed_knots": 18,
                    "fuel_tonnes_per_day": 40,
                    "ml_features": ML_FEATURES,
                },
                {
                    "route_id": "alternative-A",
                    "distance_nm": 9000,
                    "speed_knots": 18,
                    "fuel_tonnes_per_day": 40,
                    "ml_features": ML_FEATURES,
                },
            ]
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def get_route(result, route_id):
    return next(
        route for route in result["routes"]
        if route["route_id"] == route_id
    )


def test_cyclone_changes_maritime_recommendation_risk(client):
    # Baseline: both routes use normal ML predictions.
    baseline = recommend(client)
    before = get_route(baseline, "3")
    alternative_before = get_route(baseline, "alternative-A")

    assert before["risk_source"] == "ml_prediction"
    assert before["risk_score"] == before["ml_risk_score"]
    assert alternative_before["risk_source"] == "ml_prediction"

    # Trigger Danwin's simulated cyclone on database route 3.
    simulation_response = client.post(
        "/simulation/climate",
        json={
            "scenario": "severe",
            "route_id": 3,
            "event_type": "cyclone",
        },
    )

    assert simulation_response.status_code == 200, simulation_response.text
    simulation = simulation_response.json()

    # The recommendation must now use the simulated risk.
    during = recommend(client)
    affected = get_route(during, "3")
    alternative_during = get_route(during, "alternative-A")

    assert affected["risk_source"] == "simulated_climate_event"
    assert affected["risk_score"] == pytest.approx(
        simulation["risk_after"]["score"], abs=0.1
    )
    assert affected["ml_risk_score"] == before["ml_risk_score"]

    # The unrelated alternative should remain unchanged.
    assert alternative_during["risk_source"] == "ml_prediction"
    assert alternative_during["risk_score"] == alternative_before["risk_score"]

    # Reset the simulated event.
    reset_response = client.post("/simulation/reset")
    assert reset_response.status_code == 200

    after_reset = recommend(client)
    restored = get_route(after_reset, "3")

    assert restored["risk_source"] == "ml_prediction"
    assert restored["risk_score"] == before["risk_score"]
    assert restored["ml_risk_score"] == before["ml_risk_score"]
