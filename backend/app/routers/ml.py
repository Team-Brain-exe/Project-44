from fastapi import APIRouter
from app.schemas.ml import MLPredictRequest, MLScoreOut
from app.ml.model import predict

router = APIRouter(prefix="/ml", tags=["ml"])


@router.post("/predict", response_model=MLScoreOut)
def predict_risk(request: MLPredictRequest):
    result = predict(request.model_dump())
    return result
