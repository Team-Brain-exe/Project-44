from sqlalchemy import Column, Integer, String, Float, Boolean, ForeignKey
from app.database import Base


class Reroute(Base):
    __tablename__ = "reroutes"

    id = Column(Integer, primary_key=True, index=True)
    original_route_id = Column(Integer, ForeignKey("routes.id"), nullable=True)
    alt = Column(String)
    via = Column(String)
    extra_days = Column(Float)
    extra_cost = Column(Float)
    confidence = Column(Float)
    reason = Column(String)
    applied = Column(Boolean, default=False)
    dismissed = Column(Boolean, default=False)
