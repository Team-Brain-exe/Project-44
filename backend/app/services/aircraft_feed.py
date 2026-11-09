"""
Server-side OpenSky OAuth2 client-credentials flow + live states fetch,
backing the aircraft overlay on the live map. Runs on the backend so the
OpenSky client secret never reaches the browser bundle.

Falls back to simulated aircraft along the same watched corridors if the
real OpenSky feed is unavailable (auth failure, network timeout, or no
aircraft currently in the bounding boxes) — so the map's aircraft layer
is never empty for a demo, regardless of third-party infra issues.
Simulated entries are clearly labeled with a "SIM·" callsign prefix.
"""

import time
import math
import requests
from app.config import settings
from app.schemas.aircraft import AircraftPosition

TOKEN_URL = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token"
STATES_URL = "https://opensky-network.org/api/states/all"

WATCHED_BBOXES = [
    {"lamin": 5, "lomin": 20, "lamax": 35, "lomax": 60},    # Red Sea / Gulf of Aden / wider Arabian airspace
    {"lamin": -5, "lomin": 90, "lamax": 15, "lomax": 115},  # Strait of Malacca / South China Sea approach
    {"lamin": 0, "lomin": 55, "lamax": 28, "lomax": 95},    # Indian airspace + Arabian Sea + Bay of Bengal
]

# Simulated flight paths along the same corridors, used as a fallback.
# Each is a list of (lat, lng) waypoints the aircraft loops between.
SIMULATED_ROUTES = [
    {
        "icao24": "sim001",
        "callsign": "SIM·CX201",
        "waypoints": [(29.9, 32.5), (20.0, 38.5), (12.5, 45.0), (15.0, 51.0)],  # Suez -> Red Sea -> Gulf of Aden
        "altitude_ft": 36000,
        "velocity_kt": 480,
        "period_sec": 240,
    },
    {
        "icao24": "sim002",
        "callsign": "SIM·SQ118",
        "waypoints": [(1.3, 103.8), (3.0, 100.5), (6.0, 97.0), (13.0, 92.0)],  # Singapore -> Malacca -> Andaman Sea
        "altitude_ft": 38000,
        "velocity_kt": 460,
        "period_sec": 300,
    },
    {
        "icao24": "sim003",
        "callsign": "SIM·AI302",
        "waypoints": [(18.9, 72.8), (15.0, 70.0), (10.0, 65.0), (6.9, 79.8)],  # Mumbai -> Arabian Sea -> Colombo
        "altitude_ft": 34000,
        "velocity_kt": 470,
        "period_sec": 260,
    },
]

_cached_token: dict | None = None


def _get_token() -> str | None:
    global _cached_token
    if not settings.opensky_client_id or not settings.opensky_client_secret:
        print("[aircraft_feed] Missing OpenSky credentials, skipping auth.")
        return None
    if _cached_token and _cached_token["expires_at"] > time.time():
        return _cached_token["value"]
    try:
        res = requests.post(
            TOKEN_URL,
            data={
                "grant_type": "client_credentials",
                "client_id": settings.opensky_client_id,
                "client_secret": settings.opensky_client_secret,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=6,
        )
        res.raise_for_status()
        data = res.json()
        _cached_token = {
            "value": data["access_token"],
            "expires_at": time.time() + data["expires_in"] - 60,
        }
        return _cached_token["value"]
    except Exception as e:
        print(f"[aircraft_feed] OpenSky auth failed: {e}")
        return None


def _fetch_real_aircraft() -> list[AircraftPosition]:
    token = _get_token()
    if not token:
        return []

    results: list[AircraftPosition] = []
    headers = {"Authorization": f"Bearer {token}"}
    for bbox in WATCHED_BBOXES:
        try:
            res = requests.get(STATES_URL, params=bbox, headers=headers, timeout=6)
            res.raise_for_status()
            states = res.json().get("states") or []
        except Exception as e:
            print(f"[aircraft_feed] OpenSky states fetch failed: {e}")
            continue
        for s in states:
            if s[5] is None or s[6] is None:
                continue
            results.append(
                AircraftPosition(
                    icao24=str(s[0]),
                    callsign=(str(s[1] or "")).strip() or str(s[0]),
                    lng=float(s[5]),
                    lat=float(s[6]),
                    headingDeg=float(s[10] or 0),
                    altitudeFt=round(float(s[13] or s[7] or 0) * 3.28084),
                    velocityKnots=round(float(s[9] or 0) * 1.94384),
                )
            )
    return results


def _lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def _bearing(lat1, lng1, lat2, lng2) -> float:
    dLng = math.radians(lng2 - lng1)
    y = math.sin(dLng) * math.cos(math.radians(lat2))
    x = math.cos(math.radians(lat1)) * math.sin(math.radians(lat2)) - math.sin(
        math.radians(lat1)
    ) * math.cos(math.radians(lat2)) * math.cos(dLng)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def _simulated_position(route: dict, now: float) -> AircraftPosition:
    waypoints = route["waypoints"]
    n = len(waypoints)
    period = route["period_sec"]
    progress = (now % period) / period * (n - 1)
    i = int(progress)
    t = progress - i
    i = min(i, n - 2)

    lat1, lng1 = waypoints[i]
    lat2, lng2 = waypoints[i + 1]
    lat = _lerp(lat1, lat2, t)
    lng = _lerp(lng1, lng2, t)
    heading = _bearing(lat1, lng1, lat2, lng2)

    return AircraftPosition(
        icao24=route["icao24"],
        callsign=route["callsign"],
        lat=lat,
        lng=lng,
        headingDeg=heading,
        altitudeFt=route["altitude_ft"],
        velocityKnots=route["velocity_kt"],
    )


def _simulated_aircraft() -> list[AircraftPosition]:
    now = time.time()
    return [_simulated_position(route, now) for route in SIMULATED_ROUTES]


def fetch_aircraft() -> list[AircraftPosition]:
    real = _fetch_real_aircraft()
    if real:
        return real
    print("[aircraft_feed] No real OpenSky data available, using simulated fallback.")
    return _simulated_aircraft()
