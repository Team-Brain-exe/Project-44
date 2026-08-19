const USE_MOCK = true;
const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL ?? "http://localhost:8000";

export type VesselPosition = {
  mmsi: string;
  name: string;
  lat: number;
  lng: number;
  heading: number;
  speedKnots: number;
  destination?: string;
};

export type AircraftPosition = {
  icao24: string;
  callsign: string;
  lat: number;
  lng: number;
  headingDeg: number;
  altitudeFt: number;
  velocityKnots: number;
};

export type RiskCorridor = {
  id: string;
  name: string;
  severity: "critical" | "high" | "medium" | "low";
  path: [number, number][];
};

const MOCK_VESSELS: VesselPosition[] = [
  {
    mmsi: "412345678",
    name: "MSC ISTANBUL",
    lat: 12.9,
    lng: 43.6,
    heading: 310,
    speedKnots: 14.2,
    destination: "Suez",
  },
  {
    mmsi: "412345679",
    name: "MAERSK KOLKATA",
    lat: 21.9,
    lng: 63.1,
    heading: 275,
    speedKnots: 16.8,
    destination: "JNPT",
  },
  {
    mmsi: "412345680",
    name: "CMA CGM MUNDRA",
    lat: 2.4,
    lng: 101.9,
    heading: 220,
    speedKnots: 12.5,
    destination: "Singapore",
  },
];

const MOCK_AIRCRAFT: AircraftPosition[] = [
  {
    icao24: "800abc",
    callsign: "AI131",
    lat: 19.1,
    lng: 72.9,
    headingDeg: 290,
    altitudeFt: 37000,
    velocityKnots: 480,
  },
  {
    icao24: "800abd",
    callsign: "SQ423",
    lat: 5.2,
    lng: 95.3,
    headingDeg: 250,
    altitudeFt: 39000,
    velocityKnots: 510,
  },
];

const MOCK_CORRIDORS: RiskCorridor[] = [
  {
    id: "corridor-redsea-suez",
    name: "Red Sea / Suez",
    severity: "critical",
    path: [
      [31.2, 32.3],
      [30.5, 32.3],
      [27.9, 34.3],
      [20.0, 38.5],
      [12.6, 43.4],
      [12.0, 45.0],
    ],
  },
  {
    id: "corridor-malacca",
    name: "Strait of Malacca",
    severity: "medium",
    path: [
      [6.0, 95.0],
      [4.0, 98.0],
      [2.6, 101.4],
      [1.3, 103.8],
    ],
  },
];

export async function fetchVessels(): Promise<VesselPosition[]> {
  if (USE_MOCK) return MOCK_VESSELS;

  const res = await fetch(`${BACKEND_URL}/vessels`);

  if (!res.ok) {
    throw new Error(`GET /vessels failed: ${res.status}`);
  }

  return res.json();
}

export async function fetchAircraft(): Promise<AircraftPosition[]> {
  if (USE_MOCK) return MOCK_AIRCRAFT;

  const res = await fetch(`${BACKEND_URL}/aircraft`);

  if (!res.ok) {
    throw new Error(`GET /aircraft failed: ${res.status}`);
  }

  return res.json();
}

export async function fetchRiskCorridors(): Promise<RiskCorridor[]> {
  if (USE_MOCK) return MOCK_CORRIDORS;

  const res = await fetch(`${BACKEND_URL}/risk/corridors`);

  if (!res.ok) {
    throw new Error(`GET /risk/corridors failed: ${res.status}`);
  }

  return res.json();
}