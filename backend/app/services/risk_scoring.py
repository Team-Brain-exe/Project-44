"""
Bridges real DB records (Route, Alert, Port) into the feature vector the
ML model (app/ml/) expects, then translates the raw prediction into
something the API/frontend can use directly.

This module does NOT reimplement scoring logic — app/ml/model.py already
does the actual prediction. This is the glue: build features from what's
in the database, call predict(), interpret the result.
"""

from sqlalchemy.orm import Session

from app.models.alert import Alert
from app.models.route import Route
from app.models.port import Port
from app.ml.model import predict

CHOKEPOINT_TYPES = {"canal", "strait"}

# score thresholds -> risk label
RISK_HIGH = 67
RISK_MEDIUM = 34


def risk_label(score: float) -> str:
    if score >= RISK_HIGH:
        return "high"
    if score >= RISK_MEDIUM:
        return "medium"
    return "low"


def _route_alerts(db: Session, route: Route) -> list[Alert]:
    """Active (non-dismissed) alerts whose `route` text references this route."""
    label = f"{route.origin} - {route.destination}"
    matches = (
        db.query(Alert)
        .filter(Alert.dismissed == False)  # noqa: E712
        .filter(Alert.route == label)
        .all()
    )
    if matches:
        return matches
    if not route.via:
        return []
    return (
        db.query(Alert)
        .filter(Alert.dismissed == False)  # noqa: E712
        .filter(Alert.route.ilike(f"%{route.via}%"))
        .all()
    )


def _is_chokepoint(db: Session, route: Route) -> int:
    if not route.via:
        return 0
    match = (
        db.query(Port)
        .filter(Port.name.ilike(f"%{route.via}%"))
        .filter(Port.type.in_(CHOKEPOINT_TYPES))
        .first()
    )
    return 1 if match else 0


def _port_congestion_pct(route: Route) -> float:
    """No congestion feed exists — derive a rough proxy from current delay (days)."""
    if not route.delay:
        return 0.0
    return max(0.0, min(100.0, route.delay * 20))


def build_route_features(db: Session, route: Route, alerts: list[Alert]) -> dict:
    active_alerts = alerts or []
    all_active = db.query(Alert).filter(Alert.dismissed == False).all()  # noqa: E712

    severity = max((a.severity for a in active_alerts), default=0)
    age_hours = min((a.age_min for a in active_alerts), default=0) / 60.0
    route_overlap = len(active_alerts) / len(all_active) if all_active else 0.0
    weather_severity = max(
        (a.severity for a in active_alerts if a.type == "weather"), default=0
    )

    return {
        "severity": severity,
        "age_hours": round(age_hours, 2),
        "route_overlap": round(route_overlap, 3),
        "is_chokepoint": _is_chokepoint(db, route),
        "freight_value_musd": route.freight or 0.0,
        "vessel_count_nearby": len(active_alerts),
        "weather_severity": weather_severity,
        "port_congestion_pct": _port_congestion_pct(route),
    }


def score_route(db: Session, route: Route) -> dict:
    """
    Computes a risk score for a single route using related alerts + port data.
    Returns the ML prediction plus a risk label and the contributing alerts.
    """
    alerts = _route_alerts(db, route)
    features = build_route_features(db, route, alerts)
    result = predict(features)

    return {
        "route_id": route.id,
        "score": result["score"],
        "confidence": result["confidence"],
        "risk": risk_label(result["score"]),
        "features": result["features"],
        "contributing_alerts": [a.id for a in alerts],
    }


def score_all_routes(db: Session) -> list[dict]:
    routes = db.query(Route).all()
    return [score_route(db, route) for route in routes]


def score_alert(db: Session, alert: Alert) -> dict:
    """
    Standalone risk score for a single alert, independent of any route.
    Uses whatever chokepoint signal we can infer from the alert's location text.
    """
    is_chokepoint = 0
    if alert.location:
        match = (
            db.query(Port)
            .filter(Port.name.ilike(f"%{alert.location}%"))
            .filter(Port.type.in_(CHOKEPOINT_TYPES))
            .first()
        )
        is_chokepoint = 1 if match else 0

    features = {
        "severity": alert.severity or 0,
        "age_hours": (alert.age_min or 0) / 60.0,
        "route_overlap": 0.0,
        "is_chokepoint": is_chokepoint,
        "freight_value_musd": 0.0,
        "vessel_count_nearby": 1,
        "weather_severity": alert.severity if alert.type == "weather" else 0,
        "port_congestion_pct": 0.0,
    }
    result = predict(features)

    return {
        "alert_id": alert.id,
        "score": result["score"],
        "confidence": result["confidence"],
        "risk": risk_label(result["score"]),
        "features": result["features"],
    }
