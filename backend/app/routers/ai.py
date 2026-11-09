from fastapi import APIRouter

from app.schemas.ai_analysis import RiskAnalysisRequest, RiskAnalysisOut
from app.services.ai_analysis import generate_risk_analysis

router = APIRouter(prefix="/ai", tags=["ai"])


@router.post("/risk-analysis", response_model=RiskAnalysisOut)
def risk_analysis(request: RiskAnalysisRequest):
    text = generate_risk_analysis(request)
    return {"text": text}
