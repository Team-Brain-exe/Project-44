from unittest.mock import MagicMock, patch

from app.models.route import Route
from app.models.reroute import Reroute
from app.services.reroute_engine import (
    _candidate_ports,
    create_reroute_suggestions,
    generate_reroute_candidates,
)


def make_route(origin, destination, via, route_id=1):
    return Route(
        id=route_id,
        origin=origin,
        destination=destination,
        via=via,
    )


def test_geographical_alternatives():
    db = MagicMock()

    shanghai = make_route("Shanghai", "Rotterdam", "Suez Canal")
    candidates = _candidate_ports(db, shanghai)
    assert [p.name for p in candidates] == ["Cape of Good Hope"]

    mumbai = make_route("Mumbai", "Jebel Ali", "Strait of Hormuz")
    assert _candidate_ports(db, mumbai) == []

    singapore = make_route("Shanghai", "Singapore", "Strait of Malacca")
    assert [p.name for p in _candidate_ports(db, singapore)] == [
        "Lombok Strait"
    ]


@patch("app.services.reroute_engine.generate_ai_reason", return_value=None)
@patch("app.services.reroute_engine.score_route")
def test_missing_confidence_preserved(mock_score, mock_reason):
    mock_score.return_value = {
        "score": 80,
        "confidence": None,
        "features": {"severity": 5},
        "contributing_alerts": [],
    }

    route = make_route("Shanghai", "Rotterdam", "Suez Canal")
    candidates = generate_reroute_candidates(MagicMock(), route)

    assert len(candidates) == 1
    assert candidates[0]["via"] == "Cape of Good Hope"
    assert candidates[0]["confidence"] is None


@patch("app.services.reroute_engine.generate_reroute_candidates")
def test_duplicate_suggestion_reused(mock_candidates):
    mock_candidates.return_value = [{
        "original_route_id": 1,
        "alt": "Shanghai - Rotterdam (alternate)",
        "via": "Cape of Good Hope",
        "extra_days": 0.0,
        "extra_cost": 0.0,
        "extra_co2_tonnes": 0.0,
        "confidence": None,
        "reason": "Elevated route risk",
        "applied": False,
        "dismissed": False,
    }]

    existing = Reroute(id=7, original_route_id=1, via="Cape of Good Hope")
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = existing

    result = create_reroute_suggestions(
        db,
        make_route("Shanghai", "Rotterdam", "Suez Canal"),
    )

    assert result == [existing]
    db.add.assert_not_called()
    db.commit.assert_not_called()
