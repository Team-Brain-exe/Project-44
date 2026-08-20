from pydantic import BaseModel


class RerouteBase(BaseModel):
    original_route_id: int | None = None
    alt: str
    via: str
    extra_days: float
    extra_cost: float
    confidence: float
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
