from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.alert import Alert
from app.schemas.alert import AlertOut, AlertCreate, AlertUpdate

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
