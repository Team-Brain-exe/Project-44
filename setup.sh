#!/bin/bash
set -e

echo "================================"
echo "Project44 - Full Environment Setup"
echo "================================"

# ---------- DETECT CODESPACE URLS ----------
if [ -n "$CODESPACE_NAME" ]; then
  BACKEND_URL="https://${CODESPACE_NAME}-8000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
  FRONTEND_URL="https://${CODESPACE_NAME}-5173.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
  echo ">> Detected Codespace. Backend URL will be: $BACKEND_URL"
else
  BACKEND_URL="http://localhost:8000"
  FRONTEND_URL="http://localhost:5173"
  echo ">> Not in a Codespace, using localhost URLs."
fi

# ---------- FRONTEND ----------
echo ""
echo ">> Installing frontend dependencies (pnpm)..."
cd /workspaces/Project-44
pnpm install

echo ">> Writing frontend .env..."
cat > .env << ENVEOF
VITE_BACKEND_URL=${BACKEND_URL}
ENVEOF

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
pip install --upgrade pip -q
pip install -q fastapi "uvicorn[standard]" sqlalchemy alembic pydantic-settings scikit-learn xgboost pandas numpy joblib python-dotenv twilio pytest httpx
pip freeze > requirements.txt

echo ">> Writing backend .env..."
cat > .env << ENVEOF
DATABASE_URL=sqlite:///./project44.db
FAST2SMS_API_KEY=
ML_MODEL_PATH=app/ml/artifacts/model.pkl
FRONTEND_URL=${FRONTEND_URL}
ENVEOF

# ---------- ML MODEL ----------
if [ ! -f "app/ml/artifacts/model.pkl" ]; then
  echo ">> Training ML model (artifact missing)..."
  python -m app.ml.train
else
  echo ">> ML model artifact already exists, skipping training."
fi

# ---------- SEED DATA ----------
echo ">> Seeding database..."
python -m data.seed || echo "   (seed skipped or already seeded)"

echo ""
echo "================================"
echo "Setup complete!"
echo "================================"
echo ""
echo "Backend URL:  $BACKEND_URL"
echo "Frontend URL: $FRONTEND_URL"
echo ""
echo "To run the backend:"
echo "  cd backend && source venv/bin/activate && uvicorn app.main:app --reload --port 8000"
echo ""
echo "To run the frontend:"
echo "  cd /workspaces/Project-44 && pnpm run dev -- --port 5173"
echo ""
echo "IMPORTANT: In the Ports tab, set both port 8000 and 5173 to Public."
echo ""
