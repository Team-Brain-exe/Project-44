"""
Populates ports, routes, and alerts with realistic sample data so the
frontend has something real to show instead of hardcoded mock data,
and so risk_scoring / reroute_engine have something to compute against.

Run manually from backend/:
    python -m data.seed

By default this WIPES existing rows in ports/routes/alerts/reroutes/
notifications before inserting (leaves user_devices alone, since those
are real phone numbers you registered). Pass --keep to skip the wipe
and just add on top of what's there.
"""

import sys

from app.database import Base, engine, SessionLocal
from app.models.port import Port
from app.models.route import Route
from app.models.alert import Alert
from app.models.reroute import Reroute
from app.models.notification import Notification
from app.models.user_device import UserDevice  # noqa: F401 -- unused, but must be imported so Base.metadata knows this table exists for notifications's FK

PORTS = [
    {"name": "Suez Canal", "country": "Egypt", "latitude": 30.5852, "longitude": 32.2654, "type": "canal"},
    {"name": "Panama Canal", "country": "Panama", "latitude": 9.0800, "longitude": -79.6800, "type": "canal"},
    {"name": "Strait of Hormuz", "country": "Iran/Oman", "latitude": 26.5667, "longitude": 56.2500, "type": "strait"},
    {"name": "Strait of Malacca", "country": "Malaysia/Indonesia", "latitude": 2.5000, "longitude": 101.5000, "type": "strait"},
    {"name": "Port of Singapore", "country": "Singapore", "latitude": 1.2644, "longitude": 103.8200, "type": "port"},
    {"name": "Port of Rotterdam", "country": "Netherlands", "latitude": 51.9496, "longitude": 4.1453, "type": "port"},
    {"name": "Port of Shanghai", "country": "China", "latitude": 31.2304, "longitude": 121.4737, "type": "port"},
    {"name": "Jawaharlal Nehru Port (JNPT)", "country": "India", "latitude": 18.9490, "longitude": 72.9525, "type": "port"},
    {"name": "Port of Los Angeles", "country": "United States", "latitude": 33.7395, "longitude": -118.2610, "type": "port"},
    {"name": "Port of Jebel Ali", "country": "UAE", "latitude": 25.0118, "longitude": 55.0618, "type": "port"},
]

ROUTES = [
    {
        "origin": "Shanghai", "destination": "Rotterdam", "via": "Suez Canal",
        "risk": "high", "score": 0.0, "status": "active",
        "freight": 145.0, "delay": 3.5, "watched": True,
    },
    {
        "origin": "Mumbai", "destination": "Jebel Ali", "via": "Strait of Hormuz",
        "risk": "high", "score": 0.0, "status": "active",
        "freight": 62.0, "delay": 1.5, "watched": True,
    },
    {
        "origin": "Singapore", "destination": "Los Angeles", "via": "Panama Canal",
        "risk": "medium", "score": 0.0, "status": "active",
        "freight": 98.0, "delay": 0.5, "watched": False,
    },
    {
        "origin": "Shanghai", "destination": "Singapore", "via": "Strait of Malacca",
        "risk": "medium", "score": 0.0, "status": "active",
        "freight": 40.0, "delay": 0.2, "watched": False,
    },
    {
        "origin": "Rotterdam", "destination": "Los Angeles", "via": "Panama Canal",
        "risk": "low", "score": 0.0, "status": "active",
        "freight": 75.0, "delay": 0.0, "watched": False,
    },
]

# `route` text on alerts is matched against "{origin} - {destination}" first,
# then falls back to matching against `via` — so keep these consistent with ROUTES above.
ALERTS = [
    {
        "time": "06:12", "type": "security", "location": "Suez Canal",
        "route": "Shanghai - Rotterdam", "severity": 5,
        "summary": "Vessel congestion reported near canal entrance following security incident.",
        "age_min": 45, "dismissed": False,
    },
    {
        "time": "03:40", "type": "geopolitical", "location": "Strait of Hormuz",
        "route": "Mumbai - Jebel Ali", "severity": 5,
        "summary": "Heightened naval activity reported; several carriers rerouting.",
        "age_min": 120, "dismissed": False,
    },
    {
        "time": "22:05", "type": "weather", "location": "Strait of Malacca",
        "route": "Shanghai - Singapore", "severity": 3,
        "summary": "Tropical storm system tracking toward the strait, expected to intensify.",
        "age_min": 300, "dismissed": False,
    },
    {
        "time": "14:20", "type": "congestion", "location": "Panama Canal",
        "route": "Singapore - Los Angeles", "severity": 2,
        "summary": "Draft restrictions in place due to low water levels; queue times up.",
        "age_min": 600, "dismissed": False,
    },
    {
        "time": "09:55", "type": "weather", "location": "Rotterdam",
        "route": "Rotterdam - Los Angeles", "severity": 1,
        "summary": "Minor fog delays at port, expected to clear by afternoon.",
        "age_min": 90, "dismissed": False,
    },
]


def seed(wipe: bool = True):
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    try:
        if wipe:
            db.query(Notification).delete()
            db.query(Reroute).delete()
            db.query(Alert).delete()
            db.query(Route).delete()
            db.query(Port).delete()
            db.commit()

        for p in PORTS:
            db.add(Port(**p))
        for r in ROUTES:
            db.add(Route(**r))
        for a in ALERTS:
            db.add(Alert(**a))
        db.commit()

        print(f"Seeded {len(PORTS)} ports, {len(ROUTES)} routes, {len(ALERTS)} alerts.")
    finally:
        db.close()


if __name__ == "__main__":
    seed(wipe="--keep" not in sys.argv)
