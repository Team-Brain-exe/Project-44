from pydantic import BaseModel


class AlertBase(BaseModel):
    time: str
    type: str
    location: str
    route: str
    severity: int
    summary: str
    age_min: int
    dismissed: bool = False


class AlertCreate(AlertBase):
    pass


class AlertOut(AlertBase):
    id: int

    class Config:
        from_attributes = True


class AlertUpdate(BaseModel):
    dismissed: bool | None = None
