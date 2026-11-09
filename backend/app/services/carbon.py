
"""Carbon emissions estimation for logistics routes."""

from dataclasses import dataclass

# Illustrative diesel-based emission factor (kg CO2 per litre).
# Replace with a mode-specific factor for production use.
CO2_FACTOR = 2.68


@dataclass
class CarbonEstimate:
    distance_km: float
    fuel_litres: float
    co2_kg: float


def estimate_carbon(
    distance_km: float,
    fuel_litres_per_100km: float,
) -> CarbonEstimate:
    """Estimate fuel consumption and direct CO2 emissions."""

    if distance_km < 0:
        raise ValueError("Distance cannot be negative")

    if fuel_litres_per_100km <= 0:
        raise ValueError("Fuel consumption must be positive")

    fuel_used = (
        distance_km * fuel_litres_per_100km / 100
    )

    co2_emissions = fuel_used * CO2_FACTOR

    return CarbonEstimate(
        distance_km=round(distance_km, 2),
        fuel_litres=round(fuel_used, 2),
        co2_kg=round(co2_emissions, 2),
    )


@dataclass
class MaritimeCarbonEstimate:
    distance_nm: float
    speed_knots: float
    voyage_hours: float
    fuel_tonnes: float
    co2_tonnes: float


# Illustrative tank-to-wake CO2 factor for heavy fuel oil.
# Actual calculations should use the applicable fuel factor.
HFO_CO2_FACTOR = 3.114


def estimate_maritime_carbon(
    distance_nm: float,
    speed_knots: float,
    fuel_tonnes_per_day: float,
) -> MaritimeCarbonEstimate:
    """Estimate direct CO2 emissions for a maritime voyage."""

    if distance_nm < 0:
        raise ValueError("Distance cannot be negative")

    if speed_knots <= 0:
        raise ValueError("Speed must be positive")

    if fuel_tonnes_per_day <= 0:
        raise ValueError("Daily fuel consumption must be positive")

    voyage_hours = distance_nm / speed_knots
    voyage_days = voyage_hours / 24

    fuel_used = voyage_days * fuel_tonnes_per_day
    co2_emissions = fuel_used * HFO_CO2_FACTOR

    return MaritimeCarbonEstimate(
        distance_nm=round(distance_nm, 2),
        speed_knots=round(speed_knots, 2),
        voyage_hours=round(voyage_hours, 2),
        fuel_tonnes=round(fuel_used, 3),
        co2_tonnes=round(co2_emissions, 3),
    )
