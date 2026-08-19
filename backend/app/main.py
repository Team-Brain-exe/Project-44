from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import Base, engine
from app.models import alert, route, reroute, port, user_device  # noqa: F401
from app.routers import ml, alerts, routes

app = FastAPI(title="Project44 API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:8443"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

Base.metadata.create_all(bind=engine)


@app.get("/health")
def health_check():
    return {"status": "ok"}


app.include_router(ml.router)
app.include_router(alerts.router)
app.include_router(routes.router)

# Uncomment each pair below as that router is built and tested:
# from app.routers import reroutes
# app.include_router(reroutes.router)
# from app.routers import ports
# app.include_router(ports.router)
# from app.routers import notifications
# app.include_router(notifications.router)
