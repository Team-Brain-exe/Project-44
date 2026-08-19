#!/bin/bash
set -e

echo "================================"
echo "Project44 - Full Environment Setup"
echo "================================"

# ---------- FRONTEND ----------
echo ""
echo ">> Installing frontend dependencies (pnpm)..."
cd /workspaces/Project-44
pnpm install

# ---------- BACKEND ----------
echo ""
echo ">> Setting up backend..."
cd /workspaces/Project-44/backend

if [ ! -d "venv" ]; then
  echo ">> Creating virtual environment..."
  python -m venv venv
fi

source venv/bin/activate

echo ">> Installing backend dependencies..."
pip install --upgrade pip
pip install fastapi "uvicorn[standard]" sqlalchemy alembic pydantic-settings scikit-learn xgboost pandas numpy joblib python-dotenv twilio pytest httpx
pip freeze > requirements.txt

# ---------- .env ----------
if [ ! -f ".env" ]; then
  echo ">> Creating .env file..."
  cat > .env << 'ENVEOF'
DATABASE_URL=sqlite:///./project44.db
TWILIO_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=
ML_MODEL_PATH=app/ml/artifacts/model.pkl
ENVEOF
fi

# ---------- ML MODEL ----------
if [ ! -f "app/ml/artifacts/model.pkl" ]; then
  echo ">> Training ML model (artifact missing)..."
  python -m app.ml.train
else
  echo ">> ML model artifact already exists, skipping training."
fi

echo ""
echo "================================"
echo "Setup complete!"
echo "================================"
echo ""
echo "To run the backend:"
echo "  cd backend && source venv/bin/activate && uvicorn app.main:app --reload --port 8000"
echo ""
echo "To run the frontend:"
echo "  cd /workspaces/Project-44 && pnpm run dev -- --port 5173"
echo ""
