from pydantic import BaseModel


class PortBase(BaseModel):
    name: str
    country: str
    latitude: float
    longitude: float
    type: str


class PortCreate(PortBase):
    pass


class PortOut(PortBase):
    id: int

    class Config:
        from_attributes = True
