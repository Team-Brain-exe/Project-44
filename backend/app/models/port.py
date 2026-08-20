from sqlalchemy import Column, Integer, String, Float
from app.database import Base


class Port(Base):
    __tablename__ = "ports"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String)
    country = Column(String)
    latitude = Column(Float)
    longitude = Column(Float)
    type = Column(String)  # "port" / "canal" / "strait"
