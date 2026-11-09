from pydantic import BaseModel


class RerouteBase(BaseModel):
    original_route_id: int | None = None
    alt: str
    via: str
    extra_days: float | None
    extra_cost: float | None
    extra_co2_tonnes: float | None = 0.0
    confidence: float | None = None
    reason: str
    applied: bool = False
    dismissed: bool = False


class RerouteCreate(RerouteBase):
    pass


class RerouteOut(RerouteBase):
    id: int

    class Config:
        from_attributes = True


class RerouteUpdate(BaseModel):
    applied: bool | None = None
    dismissed: bool | None = None

