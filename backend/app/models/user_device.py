from sqlalchemy import Column, Integer, String, Boolean
from app.database import Base


class UserDevice(Base):
    __tablename__ = "user_devices"

    id = Column(Integer, primary_key=True, index=True)
    label = Column(String)          # e.g. "Ops manager", "On-call"
    phone_number = Column(String)   # 10-digit Indian mobile number
    active = Column(Boolean, default=True)
