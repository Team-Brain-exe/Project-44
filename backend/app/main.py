from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import Base, engine
from app.models import alert, route, reroute, port, user_device, notification  # noqa: F401
from app.routers import ml, alerts, routes, reroutes, ports, user_devices, notifications, ai, aircraft

app = FastAPI(title="Project44 API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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
app.include_router(reroutes.router)
app.include_router(ports.router)
app.include_router(user_devices.router)
app.include_router(notifications.router)
app.include_router(ai.router)
app.include_router(aircraft.router)
