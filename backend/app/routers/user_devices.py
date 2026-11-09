from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user_device import UserDevice
from app.schemas.user_device import UserDeviceOut, UserDeviceCreate, UserDeviceUpdate

router = APIRouter(prefix="/devices", tags=["devices"])


@router.get("", response_model=list[UserDeviceOut])
def list_devices(db: Session = Depends(get_db)):
    return db.query(UserDevice).all()


@router.post("", response_model=UserDeviceOut)
def create_device(device: UserDeviceCreate, db: Session = Depends(get_db)):
    db_device = UserDevice(**device.model_dump())
    db.add(db_device)
    db.commit()
    db.refresh(db_device)
    return db_device


@router.patch("/{device_id}", response_model=UserDeviceOut)
def update_device(device_id: int, update: UserDeviceUpdate, db: Session = Depends(get_db)):
    device = db.query(UserDevice).filter(UserDevice.id == device_id).first()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    for field, value in update.model_dump(exclude_unset=True).items():
        setattr(device, field, value)
    db.commit()
    db.refresh(device)
    return device


@router.delete("/{device_id}")
def delete_device(device_id: int, db: Session = Depends(get_db)):
    device = db.query(UserDevice).filter(UserDevice.id == device_id).first()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    db.delete(device)
    db.commit()
    return {"ok": True}
