from pydantic import BaseModel


class RouteBase(BaseModel):
    origin: str
    destination: str
    via: str
    risk: str
    score: float
    status: str
    freight: float
    delay: float
    watched: bool = False


class RouteCreate(RouteBase):
    pass


class RouteOut(RouteBase):
    id: int

    class Config:
        from_attributes = True


class RouteUpdate(BaseModel):
    watched: bool | None = None
