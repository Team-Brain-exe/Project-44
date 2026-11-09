"""
Controlled climate-disruption demo. Everything here is SIMULATED -- not live
meteorological data.

Reuses the existing risk model (risk_scoring) and reroute engine. The severe
scenario adds one [SIMULATED] weather alert to the route and applies an
assumed shipment delay (a scenario parameter, not a measurement) because the
ML model is driven mostly by port congestion, which the existing code derives
from route delay.
"""

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.ml.model import predict
from app.models.alert import Alert
from app.models.route import Route
from app.models.simulation import AlertAcknowledgement, SimulationEvent
from app.services.reroute_engine import create_reroute_suggestions
from app.services.risk_scoring import (
    _route_alerts,
    build_route_features,
    risk_label,
    score_route,
)

SEVERE_SEVERITY = 5
ASSUMED_DELAY_DAYS = 3.0
SIM_PREFIX = "[SIMULATED]"
DISCLAIMER = "Simulated demonstration. Not live meteorological data."


class SimulationError(Exception):
    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _route_label(route: Route) -> str:
    return f"{route.origin} - {route.destination}"


def _risk(score: float) -> dict:
    return {"score": round(float(score), 1), "risk": risk_label(score)}


def _alert_state(db: Session, alert_id: int | None) -> dict | None:
    if alert_id is None:
        return None
    ack = db.query(AlertAcknowledgement).filter(AlertAcknowledgement.alert_id == alert_id).first()
    return {
        "id": alert_id,
        "status": "acknowledged" if ack else "open",
        "acknowledged_at": ack.acknowledged_at if ack else None,
    }


def _recommendation(db: Session, route: Route) -> dict:
    suggestions = create_reroute_suggestions(db, route, persist=False)  # preview only
    if not suggestions:
        return {
            "action": "No alternative route available. Hold departures and monitor the corridor.",
            "alternatives": [],
        }
    alternatives = [
        {
            "via": s.via,
            "extra_days": s.extra_days,
            "extra_cost": s.extra_cost,
            "extra_co2_tonnes": s.extra_co2_tonnes,
        }
        for s in suggestions[:3]
    ]
    best = suggestions[0]
    return {
        "action": f"Consider rerouting via {best.via} (+{best.extra_days:g} days).",
        "reason": best.reason,
        "alternatives": alternatives,
    }


def reset_simulation(db: Session, route_id: int | None = None) -> dict:
    query = db.query(SimulationEvent)
    if route_id is not None:
        query = query.filter(SimulationEvent.route_id == route_id)
    events = query.all()
    alert_ids = [e.alert_id for e in events if e.alert_id is not None]

    if alert_ids:
        db.query(AlertAcknowledgement).filter(
            AlertAcknowledgement.alert_id.in_(alert_ids)
        ).delete(synchronize_session=False)
    for e in events:
        db.delete(e)
    db.flush()  # events reference the alerts, so remove them first
    if alert_ids:
        db.query(Alert).filter(Alert.id.in_(alert_ids)).delete(synchronize_session=False)
    db.commit()
    return {
        "simulated": True,
        "reset": True,
        "events_cleared": len(events),
        "alerts_removed": len(alert_ids),
    }


def _payload(db, route, scenario, event_type, before, after, alert_id, replayed, assumed_delay):
    return {
        "simulated": True,
        "scenario": scenario,
        "replayed": replayed,
        "event": None
        if scenario == "normal"
        else {
            "type": event_type,
            "severity": SEVERE_SEVERITY,
            "label": f"Simulated {event_type} (controlled demo, not live weather data)",
            "assumed_delay_days": assumed_delay,
        },
        "route": {"route_id": route.id, "name": _route_label(route), "via": route.via},
        "risk_before": _risk(before),
        "risk_after": _risk(after),
        "impacted_route_ids": [route.id],
        "recommendation": _recommendation(db, route)
        if scenario == "severe"
        else {"action": "No action needed. Continue normal monitoring.", "alternatives": []},
        "alert": _alert_state(db, alert_id),
        "note": DISCLAIMER,
    }


def run_climate_scenario(db: Session, scenario: str, route_id: int, event_type: str) -> dict:
    route = db.get(Route, route_id)
    if route is None:
        raise SimulationError(404, f"Route {route_id} not found")

    if scenario == "normal":
        reset_simulation(db, route_id)  # normal = no simulated disruption on this route
        base = score_route(db, route)["score"]
        return _payload(db, route, "normal", None, base, base, None, False, None)

    # severe
    existing = (
        db.query(SimulationEvent)
        .filter(SimulationEvent.route_id == route_id, SimulationEvent.scenario == "severe")
        .first()
    )
    if existing is not None:
        if existing.alert_id is None or db.get(Alert, existing.alert_id) is None:
            reset_simulation(db, route_id)  # alert was removed elsewhere; start clean
        elif existing.event_type != event_type:
            raise SimulationError(
                409, f"A simulated {existing.event_type} is already active on route {route_id}. Reset first."
            )
        else:
            return _payload(
                db, route, "severe", event_type, existing.risk_before, existing.risk_after,
                existing.alert_id, True, existing.assumed_delay_days,
            )

    before = score_route(db, route)["score"]

    alert = Alert(
        time=datetime.now(timezone.utc).strftime("%H:%M"),
        type="weather",
        location=route.via or "",
        route=_route_label(route),
        severity=SEVERE_SEVERITY,
        summary=f"{SIM_PREFIX} {event_type} disruption",
        age_min=0,
        is_forecast=False,
        eta_hours=None,
        dismissed=False,
    )
    db.add(alert)
    db.flush()

    features = build_route_features(db, route, _route_alerts(db, route))
    features["port_congestion_pct"] = max(0.0, min(100.0, ASSUMED_DELAY_DAYS * 20))
    after = predict(features)["score"]

    recommendation = _recommendation(db, route)
    alert.summary = (
        f"{SIM_PREFIX} {event_type.capitalize()} disruption on {_route_label(route)}"
        f" (via {route.via}). Risk {before:.1f} -> {after:.1f}"
        f" ({risk_label(after)}) assuming a {ASSUMED_DELAY_DAYS:g}-day delay."
        f" Action: {recommendation['action']} Not live weather data."
    )

    db.add(
        SimulationEvent(
            scenario="severe",
            route_id=route_id,
            alert_id=alert.id,
            event_type=event_type,
            severity=SEVERE_SEVERITY,
            assumed_delay_days=ASSUMED_DELAY_DAYS,
            risk_before=before,
            risk_after=after,
            created_at=_now(),
        )
    )
    db.commit()
    return _payload(db, route, "severe", event_type, before, after, alert.id, False, ASSUMED_DELAY_DAYS)


def simulation_status(db: Session) -> dict:
    events = db.query(SimulationEvent).order_by(SimulationEvent.id).all()
    return {
        "simulated": True,
        "active_events": [
            {
                "route_id": e.route_id,
                "event_type": e.event_type,
                "severity": e.severity,
                "risk_before": round(e.risk_before, 1),
                "risk_after": round(e.risk_after, 1),
                "created_at": e.created_at,
                "alert": _alert_state(db, e.alert_id),
            }
            for e in events
        ],
        "note": DISCLAIMER,
    }
