import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.ml.model import predict

client = TestClient(app)

SAMPLE_INPUT = {
    "severity": 5,
    "age_hours": 1,
    "route_overlap": 0.9,
    "is_chokepoint": 1,
    "freight_value_musd": 120,
    "vessel_count_nearby": 8,
    "weather_severity": 3,
    "port_congestion_pct": 85,
}


# ---------- Unit tests: predict() directly ----------

def test_predict_returns_score_in_range():
    result = predict(SAMPLE_INPUT)
    assert 0 <= result["score"] <= 100


def test_predict_returns_confidence_in_range():
    result = predict(SAMPLE_INPUT)
    assert 0 <= result["confidence"] <= 1


def test_predict_returns_expected_keys():
    result = predict(SAMPLE_INPUT)
    assert set(result.keys()) == {"score", "confidence", "features"}


def test_predict_features_echo_input():
    result = predict(SAMPLE_INPUT)
    assert result["features"]["severity"] == SAMPLE_INPUT["severity"]
    assert result["features"]["is_chokepoint"] == SAMPLE_INPUT["is_chokepoint"]


def test_predict_high_risk_scores_higher_than_low_risk():
    high_risk = SAMPLE_INPUT
    low_risk = {
        "severity": 1,
        "age_hours": 24,
        "route_overlap": 0.1,
        "is_chokepoint": 0,
        "freight_value_musd": 15,
        "vessel_count_nearby": 1,
        "weather_severity": 0,
        "port_congestion_pct": 15,
    }
    high_score = predict(high_risk)["score"]
    low_score = predict(low_risk)["score"]
    assert high_score > low_score


def test_predict_handles_missing_keys_gracefully():
    partial_input = {"severity": 3}
    result = predict(partial_input)
    assert 0 <= result["score"] <= 100


# ---------- API-level tests: /ml/predict endpoint ----------

def test_health_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_ml_predict_endpoint_success():
    response = client.post("/ml/predict", json=SAMPLE_INPUT)
    assert response.status_code == 200
    body = response.json()
    assert "score" in body
    assert "confidence" in body
    assert "features" in body
    assert 0 <= body["score"] <= 100


def test_ml_predict_endpoint_missing_field_returns_422():
    bad_input = SAMPLE_INPUT.copy()
    del bad_input["severity"]
    response = client.post("/ml/predict", json=bad_input)
    assert response.status_code == 422


def test_ml_predict_endpoint_wrong_type_returns_422():
    bad_input = SAMPLE_INPUT.copy()
    bad_input["severity"] = "not-a-number"
    response = client.post("/ml/predict", json=bad_input)
    assert response.status_code == 422


def test_ml_predict_endpoint_empty_body_returns_422():
    response = client.post("/ml/predict", json={})
    assert response.status_code == 422
