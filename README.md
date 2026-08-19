using new codespace bash to do : bash setup.sh

frontend: rm -rf node_modules/.vite and then npx vite --host 0.0.0.0 --port 5173

backend : cd backend
$ source venv/bin/activate && uvicorn app.main:app --reload --port 8000
