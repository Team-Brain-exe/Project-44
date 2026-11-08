
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.carbon import estimate_maritime_carbon

client = TestClient(app)


def test_maritime_carbon_calculation():
    result = estimate_maritime_carbon(
        distance_nm=1200,
        speed_knots=15,
        fuel_tonnes_per_day=25,
    )

    assert result.voyage_hours == 80
    assert result.fuel_tonnes == pytest.approx(83.333)
    assert result.co2_tonnes == pytest.approx(259.5)


def test_maritime_comparison_api():
    response = client.post(
        "/carbon/maritime/compare",
        json={
            "routes": [
                {
                    "route_id": "Route_A",
                    "distance_nm": 1200,
                    "speed_knots": 15,
                    "fuel_tonnes_per_day": 25,
                },
                {
                    "route_id": "Route_B",
                    "distance_nm": 1350,
                    "speed_knots": 14,
                    "fuel_tonnes_per_day": 22,
                },
            ]
        },
    )

    assert response.status_code == 200

    data = response.json()

    assert data["lowest_emission_route"] == "Route_A"
    assert len(data["routes"]) == 2
    assert data["routes"][0]["co2_tonnes"] == pytest.approx(259.5)


def test_invalid_maritime_input():
    response = client.post(
        "/carbon/maritime/compare",
        json={
            "routes": [
                {
                    "route_id": "Invalid_Route",
                    "distance_nm": 1200,
                    "speed_knots": 0,
                    "fuel_tonnes_per_day": 25,
                }
            ]
        },
    )

    assert response.status_code == 422


def test_zero_distance():
    result = estimate_maritime_carbon(
        distance_nm=0,
        speed_knots=15,
        fuel_tonnes_per_day=25,
    )

    assert result.fuel_tonnes == 0
    assert result.co2_tonnes == 0
