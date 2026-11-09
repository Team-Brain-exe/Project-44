from typing import Literal

from pydantic import BaseModel, Field

DEMO_ROUTE_ID = 3  # Singapore - Los Angeles in the seed data


class ClimateRequest(BaseModel):
    scenario: Literal["normal", "severe"]
    route_id: int = DEMO_ROUTE_ID
    event_type: Literal["cyclone", "flood"] = "cyclone"


class ResetRequest(BaseModel):
    route_id: int | None = None


class AckRequest(BaseModel):
    acknowledged_by: str | None = Field(default=None, max_length=100)


class AckOut(BaseModel):
    alert_id: int
    status: str
    acknowledged_at: str | None = None
    acknowledged_by: str | None = None
    already_acknowledged: bool = False
