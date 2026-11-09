from pydantic import BaseModel


class AircraftPosition(BaseModel):
    icao24: str
    callsign: str
    lng: float
    lat: float
    headingDeg: float
    altitudeFt: int
    velocityKnots: int
