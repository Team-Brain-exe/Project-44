"""
Generates reroute suggestions for routes that are currently high-risk.

Depends on risk_scoring.py to know *which* routes need rerouting and *why*
(the contributing feature), then picks candidate alternate ports to route
via and estimates the cost/time tradeoff. Suggestions are persisted as
Reroute rows — callers (the reroutes router) decide whether to auto-create
them or just preview.
"""

from sqlalchemy.orm import Session

from app.models.route import Route
from app.models.port import Port
from app.models.reroute import Reroute
from app.services.risk_scoring import score_route, RISK_MEDIUM, CHOKEPOINT_TYPES
from app.services.ai_reroute import generate_ai_reason
from app.models.alert import Alert

# Extra transit time/cost incurred by avoiding a chokepoint, per alt type.
# These are rough industry-typical deltas, not derived from any dataset.
DETOUR_PROFILES = {
    "strait": {"extra_days": 7.0, "extra_cost": 850_000.0},
    "canal": {"extra_days": 10.0, "extra_cost": 1_200_000.0},
    "port": {"extra_days": 2.0, "extra_cost": 150_000.0},
}

TOP_FEATURE_REASONS = {
    "severity": "Elevated severity across active alerts on this route",
    "age_hours": "Recent alert activity on this route",
    "route_overlap": "High concentration of active alerts on this route",
    "is_chokepoint": "Route passes through a known chokepoint",
    "freight_value_musd": "High freight value at risk on this route",
    "vessel_count_nearby": "High vessel congestion near this route",
    "weather_severity": "Severe weather affecting this route",
    "port_congestion_pct": "Significant port congestion along this route",
}


def _top_feature(features: dict) -> str:
    """Which feature contributed most to the score, used to explain the suggestion."""
    if not features:
        return "severity"
    weights = {
        "severity": 20,
        "age_hours": 1,
        "route_overlap": 100,
        "is_chokepoint": 100,
        "freight_value_musd": 0.5,
        "vessel_count_nearby": 10,
        "weather_severity": 20,
        "port_congestion_pct": 1,
    }
    return max(features, key=lambda name: features.get(name, 0) * weights.get(name, 1))


def _candidate_ports(db: Session, route: Route) -> list[Port]:
    """
    Alternate chokepoints (canal/strait) not already used as this route's
    `via`, and not the route's own origin/destination (those aren't
    alternates, they're the endpoints). Prefers chokepoints over generic
    ports since those are the meaningful detour options.
    """
    excluded_names = [route.via, route.origin, route.destination]
    query = db.query(Port).filter(Port.name.notin_(excluded_names))

    chokepoints = query.filter(Port.type.in_(CHOKEPOINT_TYPES)).limit(5).all()
    if chokepoints:
        return chokepoints

    return query.limit(5).all()


def generate_reroute_candidates(db: Session, route: Route) -> list[dict]:
    """
    Returns candidate reroute suggestions (as dicts, not yet persisted) for a
    single route, based on its current risk score and available alternate ports.
    Empty list if the route isn't risky enough to warrant rerouting.
    """
    risk_result = score_route(db, route)
    if risk_result["score"] < RISK_MEDIUM:
        return []

    contributing_alert_ids = risk_result.get("contributing_alerts", [])
    alerts = db.query(Alert).filter(Alert.id.in_(contributing_alert_ids)).all() if contributing_alert_ids else []

    ai_reason = generate_ai_reason(route, risk_result, alerts)
    reason = ai_reason if ai_reason else TOP_FEATURE_REASONS.get(
        _top_feature(risk_result["features"]), "Elevated risk detected on this route"
    )

    candidates = []
    for port in _candidate_ports(db, route):
        profile = DETOUR_PROFILES.get(port.type, DETOUR_PROFILES["port"])
        candidates.append(
            {
                "original_route_id": route.id,
                "alt": f"{route.origin} - {route.destination} (alternate)",
                "via": port.name,
                "extra_days": profile["extra_days"],
                "extra_cost": profile["extra_cost"],
                "confidence": risk_result["confidence"],
                "reason": reason,
                "applied": False,
                "dismissed": False,
            }
        )

    candidates.sort(key=lambda c: (c["extra_days"], c["extra_cost"]))
    return candidates


def create_reroute_suggestions(db: Session, route: Route, persist: bool = True) -> list[Reroute]:
    """
    Generates candidates for a route and, if persist=True, saves them as
    Reroute rows. Returns the (possibly persisted) Reroute objects.
    """
    candidates = generate_reroute_candidates(db, route)
    if not persist:
        return [Reroute(**c) for c in candidates]

    saved = []
    for c in candidates:
        reroute = Reroute(**c)
        db.add(reroute)
        db.commit()
        db.refresh(reroute)
        saved.append(reroute)
    return saved


def generate_for_all_routes(db: Session, persist: bool = True) -> list[Reroute]:
    """Runs reroute generation for every route currently in the DB."""
    routes = db.query(Route).all()
    results = []
    for route in routes:
        results.extend(create_reroute_suggestions(db, route, persist=persist))
    return results
