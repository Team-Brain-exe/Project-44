from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.simulation import ClimateRequest, ResetRequest
from app.services import climate_simulation as sim

router = APIRouter(prefix="/simulation", tags=["simulation"])


def _db_error(db: Session, action: str):
    db.rollback()
    raise HTTPException(status_code=500, detail=f"Database error while {action}")


@router.post("/climate")
def run_climate(request: ClimateRequest, db: Session = Depends(get_db)):
    try:
        return sim.run_climate_scenario(db, request.scenario, request.route_id, request.event_type)
    except sim.SimulationError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)
    except SQLAlchemyError:
        _db_error(db, "running the simulation")


@router.post("/reset")
def reset(request: ResetRequest | None = None, db: Session = Depends(get_db)):
    try:
        return sim.reset_simulation(db, request.route_id if request else None)
    except SQLAlchemyError:
        _db_error(db, "resetting the simulation")


@router.get("/status")
def status(db: Session = Depends(get_db)):
    return sim.simulation_status(db)


@router.get("/history")
def history(
    route_id: int | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """Newest first. Kept after reset. Every record is simulated."""
    return sim.list_history(db, route_id, limit)
