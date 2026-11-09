from sqlalchemy import Column, Integer, String, Float, ForeignKey, UniqueConstraint
from app.database import Base


class SimulationEvent(Base):
    """One active simulated climate event. Used for replay checks and reset."""

    __tablename__ = "simulation_events"
    __table_args__ = (UniqueConstraint("scenario", "route_id", name="uq_sim_scenario_route"),)

    id = Column(Integer, primary_key=True, index=True)
    scenario = Column(String, nullable=False)
    route_id = Column(Integer, ForeignKey("routes.id"), nullable=False)
    alert_id = Column(Integer, ForeignKey("alerts.id"), nullable=True)
    event_type = Column(String)
    severity = Column(Integer)
    assumed_delay_days = Column(Float)
    risk_before = Column(Float)
    risk_after = Column(Float)
    created_at = Column(String)


class AlertAcknowledgement(Base):
    """Kept separate from Alert so existing databases need no column changes."""

    __tablename__ = "alert_acknowledgements"

    id = Column(Integer, primary_key=True, index=True)
    alert_id = Column(Integer, ForeignKey("alerts.id"), nullable=False, unique=True)
    status = Column(String, default="acknowledged")
    acknowledged_at = Column(String)
    acknowledged_by = Column(String, nullable=True)
