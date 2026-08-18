"""
Standalone training script. Run manually:
    python -m app.ml.train
"""

import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, r2_score
import joblib
import pathlib

try:
    from app.ml.features import FEATURE_NAMES
except ImportError:
    from features import FEATURE_NAMES

THIS_DIR = pathlib.Path(__file__).parent
DATA_PATH = THIS_DIR / "../../data/raw/shipping_risk.csv"
MODEL_OUT_PATH = THIS_DIR / "artifacts/model.pkl"


def main():
    df = pd.read_csv(DATA_PATH)

    X = df[FEATURE_NAMES]
    y = df["risk_label"]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42
    )

    model = GradientBoostingRegressor(
        n_estimators=200,
        max_depth=3,
        learning_rate=0.05,
        random_state=42,
    )
    model.fit(X_train, y_train)

    preds = model.predict(X_test)
    mae = mean_absolute_error(y_test, preds)
    r2 = r2_score(y_test, preds)

    print(f"MAE: {mae:.2f}")
    print(f"R^2: {r2:.3f}")
    print("Feature importances:")
    for name, importance in zip(FEATURE_NAMES, model.feature_importances_):
        print(f"  {name}: {importance:.3f}")

    MODEL_OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, MODEL_OUT_PATH)
    print(f"\nModel saved to {MODEL_OUT_PATH}")


if __name__ == "__main__":
    main()
