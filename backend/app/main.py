from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import ml

app = FastAPI(title="Project44 API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:8443"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health_check():
    return {"status": "ok"}


app.include_router(ml.router)

# Your friend will add more routers here as they're built, e.g.:
# from app.routers import alerts, routes, reroutes, ports, notifications
# app.include_router(alerts.router)
# app.include_router(routes.router)
