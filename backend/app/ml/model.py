"""
Loads the trained model once at import time, exposes predict().
"""

import joblib
import pathlib

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

    score = float(model.predict([feature_values])[0])
    score = max(0.0, min(100.0, score))

    tree_preds = [
        float(tree[0].predict([feature_values])[0])
        for tree in model.estimators_
    ]
    spread = max(tree_preds) - min(tree_preds) if tree_preds else 0
    confidence = max(0.0, min(1.0, 1 - (spread / 100)))

    return {
        "score": round(score, 1),
        "confidence": round(confidence, 2),
        "features": features_to_dict(feature_values),
    }
