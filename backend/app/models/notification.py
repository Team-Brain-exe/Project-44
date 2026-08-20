from sqlalchemy import Column, Integer, String, Boolean, ForeignKey
from app.database import Base


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    alert_id = Column(Integer, ForeignKey("alerts.id"), nullable=True)
    device_id = Column(Integer, ForeignKey("user_devices.id"), nullable=True)
    phone_number = Column(String)
    message = Column(String)
    status = Column(String)       # "sent" / "failed"
    detail = Column(String)       # raw provider response or error text
