"""
Server-side OpenSky OAuth2 client-credentials flow + live states fetch,
backing the aircraft overlay on the live map. Runs on the backend so the
OpenSky client secret never reaches the browser bundle (the frontend
previously called OpenSky directly from client-side JS, which both leaked
the secret and got blocked by CORS on the token endpoint).
"""

import time
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

_cached_token: dict | None = None


def _get_token() -> str | None:
    global _cached_token
    print(f"[aircraft_feed] client_id set: {bool(settings.opensky_client_id)} (len={len(settings.opensky_client_id)}), client_secret set: {bool(settings.opensky_client_secret)} (len={len(settings.opensky_client_secret)})")
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
            timeout=10,
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


def fetch_aircraft() -> list[AircraftPosition]:
    token = _get_token()
    if not token:
        return []

    results: list[AircraftPosition] = []
    headers = {"Authorization": f"Bearer {token}"}

    for bbox in WATCHED_BBOXES:
        try:
            res = requests.get(STATES_URL, params=bbox, headers=headers, timeout=10)
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
