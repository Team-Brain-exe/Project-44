from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from datetime import datetime, timezone

from app.models.alert import Alert
from app.models.simulation import AlertAcknowledgement
from app.schemas.alert import AlertOut, AlertCreate, AlertUpdate
from app.schemas.simulation import AckOut, AckRequest

router = APIRouter(prefix="/alerts", tags=["alerts"])


@router.get("", response_model=list[AlertOut])
def list_alerts(db: Session = Depends(get_db)):
    return db.query(Alert).all()


@router.get("/{alert_id}", response_model=AlertOut)
def get_alert(alert_id: int, db: Session = Depends(get_db)):
    alert = db.query(Alert).filter(Alert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    return alert


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


def _get_alert_or_404(db: Session, alert_id: int) -> Alert:
    alert = db.query(Alert).filter(Alert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
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
    db.add(ack)
    db.commit()
    db.refresh(ack)
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
