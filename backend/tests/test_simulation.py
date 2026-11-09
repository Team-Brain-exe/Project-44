import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models.alert import Alert
from app.models.port import Port
from app.models.route import Route
from data.seed import ALERTS, PORTS, ROUTES

DEMO_ROUTE = 3


@pytest.fixture()
def client():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    db = Session()
    db.add_all([Port(**p) for p in PORTS])
    db.add_all([Route(**r) for r in ROUTES])
    db.add_all([Alert(**a) for a in ALERTS])
    db.commit()
    db.close()

    def override_get_db():
        session = Session()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    yield TestClient(app)
    app.dependency_overrides.clear()


def run(client, scenario="severe", **extra):
    return client.post("/simulation/climate", json={"scenario": scenario, "route_id": DEMO_ROUTE, **extra})


def alert_count(client):
    return len(client.get("/alerts").json())


def test_health_still_ok(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_normal_scenario_no_alert(client):
    before = alert_count(client)
    body = run(client, "normal").json()
    assert body["simulated"] is True
    assert body["alert"] is None
    assert body["risk_before"] == body["risk_after"]
    assert body["risk_after"]["risk"] == "low"
    assert alert_count(client) == before


def test_severe_scenario_raises_risk_and_creates_alert(client):
    normal = run(client, "normal").json()
    body = run(client, "severe").json()
    assert body["simulated"] is True
    assert body["risk_before"] == normal["risk_after"]
    assert body["risk_after"]["score"] > body["risk_before"]["score"]
    assert body["risk_after"]["risk"] == "high"
    assert body["impacted_route_ids"] == [DEMO_ROUTE]
    assert body["recommendation"]["alternatives"]
    assert body["alert"]["status"] == "open"
    alert = client.get(f"/alerts/{body['alert']['id']}").json()
    assert alert["summary"].startswith("[SIMULATED]")


def test_replay_does_not_duplicate_alerts(client):
    first = run(client, "severe").json()
    count = alert_count(client)
    second = run(client, "severe").json()
    assert second["replayed"] is True
    assert second["alert"]["id"] == first["alert"]["id"]
    assert second["risk_before"] == first["risk_before"]
    assert second["risk_after"] == first["risk_after"]
    assert alert_count(client) == count


def test_different_event_type_conflicts_until_reset(client):
    run(client, "severe", event_type="cyclone")
    assert run(client, "severe", event_type="flood").status_code == 409
    client.post("/simulation/reset")
    assert run(client, "severe", event_type="flood").status_code == 200


def test_acknowledge_save_retrieve_and_duplicate(client):
    alert_id = run(client, "severe").json()["alert"]["id"]
    assert client.get(f"/alerts/{alert_id}/acknowledgement").json()["status"] == "open"

    first = client.post(f"/alerts/{alert_id}/acknowledge", json={"acknowledged_by": "worker-1"})
    assert first.status_code == 200
    assert first.json()["status"] == "acknowledged"
    assert first.json()["already_acknowledged"] is False

    again = client.post(f"/alerts/{alert_id}/acknowledge")
    assert again.json()["already_acknowledged"] is True
    assert again.json()["acknowledged_at"] == first.json()["acknowledged_at"]

    saved = client.get(f"/alerts/{alert_id}/acknowledgement").json()
    assert saved["status"] == "acknowledged"
    assert saved["acknowledged_by"] == "worker-1"
    assert client.get("/simulation/status").json()["active_events"][0]["alert"]["status"] == "acknowledged"


def test_reset_clears_state_and_demo_repeats(client):
    baseline = alert_count(client)
    first = run(client, "severe").json()
    client.post(f"/alerts/{first['alert']['id']}/acknowledge")

    reset = client.post("/simulation/reset").json()
    assert reset["events_cleared"] == 1
    assert reset["alerts_removed"] == 1
    assert alert_count(client) == baseline
    assert client.get("/simulation/status").json()["active_events"] == []

    again = run(client, "severe").json()
    assert again["replayed"] is False
    assert again["alert"]["status"] == "open"
    assert again["risk_after"] == first["risk_after"]


def test_invalid_route_and_bad_input(client):
    assert client.post("/simulation/climate", json={"scenario": "severe", "route_id": 999}).status_code == 404
    assert client.post("/simulation/climate", json={}).status_code == 422
    assert client.post("/simulation/climate", json={"scenario": "volcano"}).status_code == 422
    assert client.post("/alerts/9999/acknowledge").status_code == 404
    assert client.get("/alerts/9999/acknowledgement").status_code == 404


def test_existing_alert_and_reroute_endpoints_still_work(client):
    assert client.get("/alerts").status_code == 200
    assert client.get("/reroutes").status_code == 200
    assert client.get("/alerts/1").status_code == 200
