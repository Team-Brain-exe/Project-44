from sqlalchemy import Column, Integer, String, Boolean
from app.database import Base


class Alert(Base):
    __tablename__ = "alerts"

    id = Column(Integer, primary_key=True, index=True)
    time = Column(String)
    type = Column(String)
    location = Column(String)
    route = Column(String)
    severity = Column(Integer)
    summary = Column(String)
    age_min = Column(Integer)
    dismissed = Column(Boolean, default=False)
