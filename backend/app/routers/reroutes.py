from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.reroute import Reroute
from app.schemas.reroute import RerouteOut, RerouteCreate, RerouteUpdate

router = APIRouter(prefix="/reroutes", tags=["reroutes"])


@router.get("", response_model=list[RerouteOut])
def list_reroutes(db: Session = Depends(get_db)):
    return db.query(Reroute).all()


@router.post("", response_model=RerouteOut)
def create_reroute(reroute: RerouteCreate, db: Session = Depends(get_db)):
    db_reroute = Reroute(**reroute.model_dump())
    db.add(db_reroute)
    db.commit()
    db.refresh(db_reroute)
    return db_reroute


@router.patch("/{reroute_id}/apply", response_model=RerouteOut)
def apply_reroute(reroute_id: int, db: Session = Depends(get_db)):
    reroute = db.query(Reroute).filter(Reroute.id == reroute_id).first()
    if not reroute:
        raise HTTPException(status_code=404, detail="Reroute not found")
    reroute.applied = True
    db.commit()
    db.refresh(reroute)
    return reroute


@router.patch("/{reroute_id}/dismiss", response_model=RerouteOut)
def dismiss_reroute(reroute_id: int, db: Session = Depends(get_db)):
    reroute = db.query(Reroute).filter(Reroute.id == reroute_id).first()
    if not reroute:
        raise HTTPException(status_code=404, detail="Reroute not found")
    reroute.dismissed = True
    db.commit()
    db.refresh(reroute)
    return reroute
