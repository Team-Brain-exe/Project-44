from fastapi import APIRouter

from app.schemas.aircraft import AircraftPosition
from app.services.aircraft_feed import fetch_aircraft

router = APIRouter(prefix="/aircraft", tags=["aircraft"])


@router.get("/live", response_model=list[AircraftPosition])
def live_aircraft():
    return fetch_aircraft()
