from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.port import Port
from app.schemas.port import PortOut, PortCreate

router = APIRouter(prefix="/ports", tags=["ports"])


@router.get("", response_model=list[PortOut])
def list_ports(db: Session = Depends(get_db)):
    return db.query(Port).all()


@router.get("/{port_id}", response_model=PortOut)
def get_port(port_id: int, db: Session = Depends(get_db)):
    port = db.query(Port).filter(Port.id == port_id).first()
    if not port:
        raise HTTPException(status_code=404, detail="Port not found")
    return port


@router.post("", response_model=PortOut)
def create_port(port: PortCreate, db: Session = Depends(get_db)):
    db_port = Port(**port.model_dump())
    db.add(db_port)
    db.commit()
    db.refresh(db_port)
    return db_port
