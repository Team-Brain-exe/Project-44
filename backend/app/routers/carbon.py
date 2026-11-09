
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from typing import List
from app.services.carbon import estimate_carbon, estimate_maritime_carbon
from app.schemas.ml import MLPredictRequest
from app.services.route_recommendation import recommend_routes
from app.services.maritime_recommendation import recommend_maritime_routes
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.route import Route
from app.models.simulation import SimulationEvent

router = APIRouter(prefix="/carbon", tags=["Carbon Emissions"])


class RouteInput(BaseModel):
    route_id: str
    distance_km: float = Field(ge=0)
    fuel_litres_per_100km: float = Field(gt=0)


class CompareRequest(BaseModel):
    routes: List[RouteInput] = Field(min_length=1)


@router.post("/compare")
def compare_routes(request: CompareRequest):
    results = []

    for route in request.routes:
        estimate = estimate_carbon(
            route.distance_km,
            route.fuel_litres_per_100km,
        )

        results.append({
            "route_id": route.route_id,
            "distance_km": estimate.distance_km,
            "fuel_litres": estimate.fuel_litres,
            "co2_kg": estimate.co2_kg,
        })

    best = min(results, key=lambda r: r["co2_kg"])

    return {
        "routes": results,
        "lowest_emission_route": best["route_id"],
    }


class RecommendRouteInput(BaseModel):
    route_id: str
    distance_km: float = Field(ge=0)
    fuel_litres_per_100km: float = Field(gt=0)
    ml_features: MLPredictRequest


class RecommendRequest(BaseModel):
    routes: List[RecommendRouteInput] = Field(min_length=1)


@router.post("/recommend")
def recommend_carbon_routes(request: RecommendRequest):
    route_data = [
        route.model_dump()
        for route in request.routes
    ]

    return recommend_routes(route_data)


class MaritimeRouteInput(BaseModel):
    route_id: str
    distance_nm: float = Field(ge=0)
    speed_knots: float = Field(gt=0)
    fuel_tonnes_per_day: float = Field(gt=0)


class MaritimeCompareRequest(BaseModel):
    routes: List[MaritimeRouteInput] = Field(min_length=1)


@router.post("/maritime/compare")
def compare_maritime_routes(request: MaritimeCompareRequest):
    results = []

    for route in request.routes:
        estimate = estimate_maritime_carbon(
            distance_nm=route.distance_nm,
            speed_knots=route.speed_knots,
            fuel_tonnes_per_day=route.fuel_tonnes_per_day,
        )

        results.append({
            "route_id": route.route_id,
            "distance_nm": estimate.distance_nm,
            "speed_knots": estimate.speed_knots,
            "voyage_hours": estimate.voyage_hours,
            "fuel_tonnes": estimate.fuel_tonnes,
            "co2_tonnes": estimate.co2_tonnes,
        })

    best = min(results, key=lambda r: r["co2_tonnes"])

    return {
        "routes": results,
        "lowest_emission_route": best["route_id"],
        "emission_unit": "tonnes CO2",
        "method": "Illustrative tank-to-wake HFO emissions estimate",
    }

class MaritimeRecommendRouteInput(BaseModel):
    route_id: str
    distance_nm: float = Field(ge=0)
    speed_knots: float = Field(gt=0)
    fuel_tonnes_per_day: float = Field(gt=0)
    ml_features: MLPredictRequest


class MaritimeRecommendRequest(BaseModel):
    routes: List[MaritimeRecommendRouteInput] = Field(min_length=1)


@router.post("/maritime/recommend")
def recommend_maritime_routes_api(
    request: MaritimeRecommendRequest,
    db: Session = Depends(get_db),
):
    route_data = [route.model_dump() for route in request.routes]

    simulated_risks = {}

    for route in request.routes:
        route_id = route.route_id

        if not route_id.isdecimal():
            continue

        db_route_id = int(route_id)

        if db.get(Route, db_route_id) is None:
            continue

        event = (
            db.query(SimulationEvent)
            .filter(
                SimulationEvent.route_id == db_route_id,
                SimulationEvent.scenario == "severe",
            )
            .first()
        )

        if event is not None:
            simulated_risks[route_id] = event.risk_after

    return recommend_maritime_routes(
        route_data,
        simulated_risks=simulated_risks,
    )
