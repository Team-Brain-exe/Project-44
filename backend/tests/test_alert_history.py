import pytest
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.services import climate_simulation
from tests.test_simulation import client  # isolated in-memory DB fixture  # noqa: F401


def sim(client, scenario="severe", route_id=3, **extra):
    return client.post(
        "/simulation/climate", json={"scenario": scenario, "route_id": route_id, **extra}
    )


def simulated_alerts(client, **params):
    alerts = client.get("/alerts", params=params).json()
    return [a for a in alerts if a["simulated"]]


def history(client, **params):
    response = client.get("/simulation/history", params=params)
    assert response.status_code == 200, response.text
    return response.json()


# ---------- P1: smart alerts ----------

def test_high_risk_creates_exactly_one_actionable_alert(client):
    body = sim(client).json()
    assert body["risk_after"]["score"] >= 60

    alerts = simulated_alerts(client, status="active", route_id=3)
    assert len(alerts) == 1
    alert = alerts[0]
    assert alert["id"] == body["alert"]["id"]
    assert alert["route_id"] == 3
    assert alert["event_type"] == "cyclone"
    assert alert["status"] == "active"
    assert alert["created_at"] is not None
    assert alert["acknowledged_at"] is None
    assert alert["summary"].startswith("[SIMULATED]")


def test_below_threshold_event_creates_no_alert(client, monkeypatch):
    monkeypatch.setattr(climate_simulation, "ASSUMED_DELAY_DAYS", 0.5)
    before_count = len(client.get("/alerts").json())

    body = sim(client).json()
    assert body["risk_after"]["score"] < 60
    assert body["alert"] is None
    assert "below the safety threshold" in body["recommendation"]["action"]
    assert len(client.get("/alerts").json()) == before_count

    # The event is still active and audited, just without an alert.
    assert len(client.get("/simulation/status").json()["active_events"]) == 1
    entry = history(client)["events"][0]
    assert entry["alert_id"] is None
    assert entry["status"] == "active"

    # A replay is a replay, not a stale event.
    assert sim(client).json()["replayed"] is True


def test_acknowledge_updates_status_and_filters(client):
    alert_id = sim(client).json()["alert"]["id"]

    first = client.post(f"/alerts/{alert_id}/acknowledge", json={"acknowledged_by": "worker-1"})
    assert first.status_code == 200
    again = client.post(f"/alerts/{alert_id}/acknowledge")
    assert again.json()["already_acknowledged"] is True
    assert again.json()["acknowledged_at"] == first.json()["acknowledged_at"]

    stored = client.get(f"/alerts/{alert_id}").json()
    assert stored["status"] == "acknowledged"
    assert stored["acknowledged_at"] == first.json()["acknowledged_at"]

    assert alert_id not in [a["id"] for a in client.get("/alerts", params={"status": "active"}).json()]
    acknowledged = client.get("/alerts", params={"status": "acknowledged"}).json()
    assert [a["id"] for a in acknowledged] == [alert_id]

    assert client.post("/alerts/9999/acknowledge").status_code == 404


def test_alert_list_filters_and_validation(client):
    sim(client)
    everything = client.get("/alerts").json()
    assert len(everything) == 8  # 7 seeded + 1 simulated, unchanged default behavior

    route_3 = client.get("/alerts", params={"route_id": 3}).json()
    assert route_3 and all(a["route_id"] == 3 for a in route_3)
    assert client.get("/alerts", params={"route_id": 999}).json() == []

    assert client.get("/alerts", params={"status": "bogus"}).status_code == 422
    assert client.get("/alerts", params={"route_id": "abc"}).status_code == 422
    assert client.get("/alerts/9999").status_code == 404

    # Existing keys are still present (additive change only).
    for key in ("id", "time", "type", "location", "route", "severity", "summary", "dismissed"):
        assert key in everything[0]


def test_no_duplicate_alert_on_replay_but_new_event_after_reset_gets_one(client):
    first = sim(client).json()
    assert sim(client).json()["alert"]["id"] == first["alert"]["id"]
    assert len(simulated_alerts(client)) == 1

    client.post("/simulation/reset")
    assert simulated_alerts(client) == []

    second = sim(client).json()
    assert second["replayed"] is False
    assert len(simulated_alerts(client)) == 1


def test_database_error_on_acknowledge_returns_500(client, monkeypatch):
    alert_id = sim(client).json()["alert"]["id"]

    def broken_commit(self):
        raise OperationalError("COMMIT", {}, Exception("disk I/O error"))

    monkeypatch.setattr(Session, "commit", broken_commit)
    response = client.post(f"/alerts/{alert_id}/acknowledge")
    assert response.status_code == 500
    assert "Database error" in response.json()["detail"]


# ---------- P2: history ----------

def test_history_records_before_after_and_labels_simulated(client):
    body = sim(client).json()
    data = history(client)
    assert data["simulated"] is True

    entry = data["events"][0]
    assert entry["id"] == body["history_id"]
    assert entry["simulated"] is True
    assert entry["route_id"] == 3
    assert entry["scenario"] == "severe"
    assert entry["event_type"] == "cyclone"
    assert entry["risk_before"] == body["risk_before"]["score"]
    assert entry["risk_after"] == body["risk_after"]["score"]
    assert entry["alert_id"] == body["alert"]["id"]
    assert entry["status"] == "active"
    assert entry["created_at"] is not None
    assert entry["reset_at"] is None


def test_history_order_route_filter_and_limit(client):
    sim(client, "normal", route_id=3)
    sim(client, "severe", route_id=3)
    client.post("/simulation/reset")
    sim(client, "severe", route_id=2)

    events = history(client)["events"]
    assert [e["id"] for e in events] == sorted((e["id"] for e in events), reverse=True)
    assert events[0]["route_id"] == 2  # newest first
    assert len(events) == 3

    only_3 = history(client, route_id=3)["events"]
    assert len(only_3) == 2 and all(e["route_id"] == 3 for e in only_3)

    assert len(history(client, limit=1)["events"]) == 1
    assert client.get("/simulation/history", params={"limit": 0}).status_code == 422
    assert client.get("/simulation/history", params={"limit": 101}).status_code == 422
    assert history(client, route_id=999)["events"] == []


def test_reset_clears_active_state_but_keeps_history(client):
    body = sim(client).json()
    client.post(f"/alerts/{body['alert']['id']}/acknowledge")

    reset = client.post("/simulation/reset").json()
    assert reset["history_marked_reset"] == 1

    assert client.get("/simulation/status").json()["active_events"] == []
    assert simulated_alerts(client) == []

    entry = history(client)["events"][0]
    assert entry["id"] == body["history_id"]
    assert entry["status"] == "reset"
    assert entry["reset_at"] is not None
    assert entry["risk_after"] == body["risk_after"]["score"]


def test_retries_do_not_duplicate_history(client):
    sim(client, "normal")
    sim(client, "normal")
    assert len(history(client)["events"]) == 1

    sim(client, "severe")
    sim(client, "severe")  # replay
    assert len(history(client)["events"]) == 2

    sim(client, "normal")  # returning to normal is a new, legitimate record
    events = history(client)["events"]
    assert [e["scenario"] for e in events] == ["normal", "severe", "normal"]
    assert events[1]["status"] == "reset"  # the severe run was closed by going back to normal


def test_repeated_legitimate_simulations_are_all_kept(client):
    for _ in range(3):
        sim(client)
        client.post("/simulation/reset")
    events = history(client)["events"]
    assert len(events) == 3
    assert all(e["status"] == "reset" for e in events)
