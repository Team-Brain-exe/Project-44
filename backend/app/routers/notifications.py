from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models.alert import Alert
from app.models.user_device import UserDevice
from app.models.notification import Notification
from app.schemas.notification import NotificationOut, NotificationSendRequest
from app.services.notify import send_sms

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=list[NotificationOut])
def list_notifications(db: Session = Depends(get_db)):
    return db.query(Notification).all()


@router.post("/send", response_model=list[NotificationOut])
def send_notification(payload: NotificationSendRequest, db: Session = Depends(get_db)):
    alert = db.query(Alert).filter(Alert.id == payload.alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    devices = db.query(UserDevice).filter(UserDevice.active == True).all()  # noqa: E712

    if not devices and settings.demo_mode:
        # No real devices registered yet (fresh deploy / no one's added their
        # number). Rather than 400 the whole "Notify Team" flow in front of a
        # demo audience, auto-provision one placeholder device so the button
        # always completes end-to-end. send_sms() will fall back to a
        # "simulated" send for it, same as for any other unreachable device.
        demo_device = UserDevice(label="Demo Ops Team", phone_number="9999999999", active=True)
        db.add(demo_device)
        db.commit()
        db.refresh(demo_device)
        devices = [demo_device]

    if not devices:
        raise HTTPException(status_code=400, detail="No active devices to notify")

    results = []
    for device in devices:
        outcome = send_sms(device.phone_number, payload.message)
        notification = Notification(
            alert_id=alert.id,
            device_id=device.id,
            phone_number=device.phone_number,
            message=payload.message,
            status=outcome["status"],
            detail=outcome["detail"],
        )
        db.add(notification)
        db.commit()
        db.refresh(notification)
        results.append(notification)

    return results

