from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import Base, engine
from app.models import alert, route, reroute, port, user_device  # noqa: F401 — import so tables register with Base
from app.routers import ml

app = FastAPI(title="Project44 API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:8443"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Creates all tables defined in app/models/*.py if they don't already exist.
# Safe to run every time the server starts — it won't touch tables that already exist.
Base.metadata.create_all(bind=engine)


@app.get("/health")
def health_check():
    return {"status": "ok"}


app.include_router(ml.router)

# Add more routers here as they're built:
# from app.routers import alerts, routes, reroutes, ports, notifications
# app.include_router(alerts.router)
# app.include_router(routes.router)
# app.include_router(reroutes.router)
# app.include_router(ports.router)
# app.include_router(notifications.router)
