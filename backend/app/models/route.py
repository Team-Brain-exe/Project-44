from sqlalchemy import Column, Integer, String, Float, Boolean
from app.database import Base


class Route(Base):
    __tablename__ = "routes"

    id = Column(Integer, primary_key=True, index=True)
    origin = Column(String)
    destination = Column(String)
    via = Column(String)
    risk = Column(String)
    score = Column(Float)
    status = Column(String)
    freight = Column(Float)
    delay = Column(Float)
    watched = Column(Boolean, default=False)
