from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.alert import Alert
from app.models.route import Route
from app.models.simulation import AlertAcknowledgement, SimulationHistory
from app.schemas.alert import AlertCreate, AlertDetailOut, AlertOut, AlertUpdate
from app.schemas.simulation import AckOut, AckRequest

router = APIRouter(prefix="/alerts", tags=["alerts"])


def _build_details(db: Session, alerts: list[Alert]) -> list[AlertDetailOut]:
    """Adds route_id, event_type, status, created_at and acknowledged_at to alerts."""
    if not alerts:
        return []
    ids = [a.id for a in alerts]

    acks = {
        a.alert_id: a
        for a in db.query(AlertAcknowledgement).filter(AlertAcknowledgement.alert_id.in_(ids))
    }
    # Only ACTIVE history rows describe a live alert (alert ids can be reused after reset).
    sims = {
        h.alert_id: h
        for h in db.query(SimulationHistory)
        .filter(SimulationHistory.alert_id.in_(ids), SimulationHistory.status == "active")
        .order_by(SimulationHistory.id)
    }
    route_ids: dict[str, int] = {}
    for r in db.query(Route).order_by(Route.id):
        route_ids.setdefault(f"{r.origin} - {r.destination}", r.id)

    details = []
    for alert in alerts:
        ack = acks.get(alert.id)
        sim = sims.get(alert.id)
        if ack:
            status = "acknowledged"
        elif alert.dismissed:
            status = "dismissed"
        else:
            status = "active"
        details.append(
            AlertDetailOut(
                **AlertOut.model_validate(alert).model_dump(),
                route_id=sim.route_id if sim else route_ids.get(alert.route),
                event_type=sim.event_type if sim else alert.type,
                status=status,
                simulated=sim is not None,
                created_at=sim.created_at if sim else None,
                acknowledged_at=ack.acknowledged_at if ack else None,
            )
        )
    return details


@router.get("", response_model=list[AlertDetailOut])
def list_alerts(
    status: Literal["active", "acknowledged", "dismissed"] | None = Query(default=None),
    route_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
):
    """No filters returns every alert, as before. Filters: status and route_id."""
    details = _build_details(db, db.query(Alert).order_by(Alert.id).all())
    if status is not None:
        details = [d for d in details if d.status == status]
    if route_id is not None:
        details = [d for d in details if d.route_id == route_id]
    return details


def _get_alert_or_404(db: Session, alert_id: int) -> Alert:
    alert = db.query(Alert).filter(Alert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    return alert


@router.get("/{alert_id}", response_model=AlertDetailOut)
def get_alert(alert_id: int, db: Session = Depends(get_db)):
    return _build_details(db, [_get_alert_or_404(db, alert_id)])[0]


@router.post("", response_model=AlertOut)
def create_alert(alert: AlertCreate, db: Session = Depends(get_db)):
    db_alert = Alert(**alert.model_dump())
    db.add(db_alert)
    db.commit()
    db.refresh(db_alert)
    return db_alert


@router.patch("/{alert_id}", response_model=AlertOut)
def update_alert(alert_id: int, update: AlertUpdate, db: Session = Depends(get_db)):
    alert = db.query(Alert).filter(Alert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    for field, value in update.model_dump(exclude_unset=True).items():
        setattr(alert, field, value)
    db.commit()
    db.refresh(alert)
    return alert


@router.post("/{alert_id}/acknowledge", response_model=AckOut)
def acknowledge_alert(alert_id: int, request: AckRequest | None = None, db: Session = Depends(get_db)):
    """Idempotent: a repeat acknowledgement returns the original timestamp."""
    _get_alert_or_404(db, alert_id)
    ack = db.query(AlertAcknowledgement).filter(AlertAcknowledgement.alert_id == alert_id).first()
    if ack:
        return AckOut(
            alert_id=alert_id, status=ack.status, acknowledged_at=ack.acknowledged_at,
            acknowledged_by=ack.acknowledged_by, already_acknowledged=True,
        )
    ack = AlertAcknowledgement(
        alert_id=alert_id,
        status="acknowledged",
        acknowledged_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        acknowledged_by=request.acknowledged_by if request else None,
    )
    try:
        db.add(ack)
        db.commit()
        db.refresh(ack)
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(status_code=500, detail="Database error while saving the acknowledgement")
    return AckOut(
        alert_id=alert_id, status=ack.status, acknowledged_at=ack.acknowledged_at,
        acknowledged_by=ack.acknowledged_by,
    )


@router.get("/{alert_id}/acknowledgement", response_model=AckOut)
def get_acknowledgement(alert_id: int, db: Session = Depends(get_db)):
    _get_alert_or_404(db, alert_id)
    ack = db.query(AlertAcknowledgement).filter(AlertAcknowledgement.alert_id == alert_id).first()
    if not ack:
        return AckOut(alert_id=alert_id, status="open")
    return AckOut(
        alert_id=alert_id, status=ack.status, acknowledged_at=ack.acknowledged_at,
        acknowledged_by=ack.acknowledged_by,
    )
