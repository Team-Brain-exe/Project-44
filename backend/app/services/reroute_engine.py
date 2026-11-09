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

# Rough estimated CO2 output for a large container vessel underway, in
# tonnes/day. This is a widely-cited order-of-magnitude figure for
# fuel-oil-burning container ships (~150-200 tonnes/day at cruising speed),
# not a precise per-vessel figure -- used here to give reroute suggestions a
# comparable, illustrative emissions delta rather than an audited one.
EMISSIONS_TONNES_CO2_PER_DAY = 170.0


def _estimate_extra_co2_tonnes(extra_days: float) -> float:
    """Rough estimated extra CO2 (tonnes) from the additional transit days a
    detour adds -- more days at sea burning bunker fuel means more emissions,
    on top of the added cost/delay already tracked. Illustrative, not audited."""
    return round(extra_days * EMISSIONS_TONNES_CO2_PER_DAY, 1)

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


# Curated demonstration alternatives. These are candidate corridors,
# not verified vessel itineraries or navigational safety guarantees.
DEMO_ALTERNATIVES = {
    ("Shanghai", "Rotterdam"): ("Cape of Good Hope",),
    ("Mumbai", "Jebel Ali"): (),
    ("Singapore", "Los Angeles"): ("North Pacific direct corridor",),
    ("Shanghai", "Singapore"): ("Lombok Strait",),
    ("Rotterdam", "Los Angeles"): (),
}


def _candidate_ports(db: Session, route: Route) -> list[Port]:
    """Return only curated demo corridors for this origin/destination."""
    names = DEMO_ALTERNATIVES.get((route.origin, route.destination), ())
    return [
        Port(name=name, type="corridor")
        for name in names
        if name != route.via
    ]


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
        profile = (
            {"extra_days": None, "extra_cost": None}
            if port.type == "corridor"
            else DETOUR_PROFILES.get(port.type, DETOUR_PROFILES["port"])
        )
        candidates.append(
            {
                "original_route_id": route.id,
                "alt": f"{route.origin} - {route.destination} (alternate)",
                "via": port.name,
                "extra_days": profile["extra_days"],
                "extra_cost": profile["extra_cost"],
                "extra_co2_tonnes": (
                    None if profile["extra_days"] is None
                    else _estimate_extra_co2_tonnes(profile["extra_days"])
                ),
                "confidence": risk_result["confidence"],
                "reason": reason,
                "applied": False,
                "dismissed": False,
            }
        )

    candidates.sort(key=lambda c: (
        c["extra_days"] is None,
        c["extra_days"] if c["extra_days"] is not None else float("inf"),
        c["extra_cost"] if c["extra_cost"] is not None else float("inf"),
    ))
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
        existing = (
            db.query(Reroute)
            .filter(
                Reroute.original_route_id == c["original_route_id"],
                Reroute.via == c["via"],
            )
            .first()
        )
        if existing:
            saved.append(existing)
            continue

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

