"""
Loads the trained model once at import time, exposes predict().
"""

import joblib
import pathlib
import pandas as pd

from app.ml.features import FEATURE_NAMES, build_features, features_to_dict

THIS_DIR = pathlib.Path(__file__).parent
MODEL_PATH = THIS_DIR / "artifacts/model.pkl"

_model = None


def _get_model():
    global _model
    if _model is None:
        _model = joblib.load(MODEL_PATH)
    return _model




def predict(data: dict) -> dict:
    model = _get_model()
    feature_values = build_features(data)

    # Convert features to DataFrame with correct column names
    feature_frame = pd.DataFrame(
        [feature_values],
        columns=FEATURE_NAMES,
    )

    # Predict climate risk score
    raw_score = float(model.predict(feature_frame)[0])

    # Keep risk score between 0 and 100
    score = max(0.0, min(100.0, raw_score))

    return {
        "score": round(score, 1),
        "confidence": None,
        "features": features_to_dict(feature_values),
    }
