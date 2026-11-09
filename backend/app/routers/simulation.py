from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.simulation import ClimateRequest, ResetRequest
from app.services import climate_simulation as sim

router = APIRouter(prefix="/simulation", tags=["simulation"])


@router.post("/climate")
def run_climate(request: ClimateRequest, db: Session = Depends(get_db)):
    try:
        return sim.run_climate_scenario(db, request.scenario, request.route_id, request.event_type)
    except sim.SimulationError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)


@router.post("/reset")
def reset(request: ResetRequest | None = None, db: Session = Depends(get_db)):
    return sim.reset_simulation(db, request.route_id if request else None)


@router.get("/status")
def status(db: Session = Depends(get_db)):
    return sim.simulation_status(db)
