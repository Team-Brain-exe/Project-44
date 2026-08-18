"""
Turns raw alert/route data into the numeric feature vector the model expects.
Order of features MUST match train.py and model.py exactly.
"""

FEATURE_NAMES = [
    "severity",
    "age_hours",
    "route_overlap",
    "is_chokepoint",
    "freight_value_musd",
    "vessel_count_nearby",
    "weather_severity",
    "port_congestion_pct",
]


def build_features(data: dict) -> list[float]:
    """
    data: dict with keys matching FEATURE_NAMES (missing keys default to 0)
    Returns a list of floats in the exact order the model was trained on.
    """
    return [float(data.get(name, 0)) for name in FEATURE_NAMES]


def features_to_dict(feature_values: list[float]) -> dict:
    """Reverse mapping — used when returning the MLScore response."""
    return dict(zip(FEATURE_NAMES, feature_values))
