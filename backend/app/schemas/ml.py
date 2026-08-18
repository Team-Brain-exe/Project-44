from pydantic import BaseModel


class MLPredictRequest(BaseModel):
    severity: float
    age_hours: float
    route_overlap: float
    is_chokepoint: int
    freight_value_musd: float
    vessel_count_nearby: float
    weather_severity: float
    port_congestion_pct: float


class MLScoreOut(BaseModel):
    score: float
    confidence: float
    features: dict
