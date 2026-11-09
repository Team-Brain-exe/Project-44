from pydantic import BaseModel


class AlertInput(BaseModel):
    severity: str
    type: str
    location: str
    summary: str


class RiskAnalysisRequest(BaseModel):
    alerts: list[AlertInput] = []
    top_location: str | None = None
    top_score: float | None = None
    top_confidence: float | None = None


class RiskAnalysisOut(BaseModel):
    text: str
