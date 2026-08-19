// OpenSky Network REST API. Uses OAuth2 client-credentials flow (required as
// of March 2026 — the old username/password auth was retired). Same caveat
// as aisstream.ts: the client secret is visible in the browser bundle since
// there's no backend to hide it behind.

import type { AircraftPosition } from "./liveData";

const TOKEN_URL =
  "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";
const STATES_URL = "https://opensky-network.org/api/states/all";

const CLIENT_ID = import.meta.env.VITE_OPENSKY_CLIENT_ID as string | undefined;
const CLIENT_SECRET = import.meta.env.VITE_OPENSKY_CLIENT_SECRET as string | undefined;

// Same watched regions as aisstream.ts, expressed as [lamin, lomin, lamax, lomax]
const WATCHED_BBOXES = [
  { lamin: 10, lomin: 40, lamax: 32, lomax: 50 }, // Red Sea / Suez approach
  { lamin: -1, lomin: 95, lamax: 8, lomax: 104 }, // Strait of Malacca
  { lamin: 8, lomin: 68, lamax: 24, lomax: 90 }, // Indian airspace
];

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getToken(): Promise<string | null> {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.warn(
      "VITE_OPENSKY_CLIENT_ID / VITE_OPENSKY_CLIENT_SECRET not set — register at opensky-network.org",
    );
    return null;
  }

  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.value;
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });

  if (!res.ok) {
    console.error("OpenSky auth failed:", res.status, await res.text());
    return null;
  }

  const data = await res.json();
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000, // refresh a bit early
  };
  return cachedToken.value;
}

/** Fetch current aircraft states across all watched bounding boxes. */
export async function fetchOpenSkyAircraft(): Promise<AircraftPosition[]> {
  const token = await getToken();
  if (!token) return [];

  const results = await Promise.all(
    WATCHED_BBOXES.map(async (bbox) => {
      const params = new URLSearchParams({
        lamin: String(bbox.lamin),
        lomin: String(bbox.lomin),
        lamax: String(bbox.lamax),
        lomax: String(bbox.lomax),
      });
      const res = await fetch(`${STATES_URL}?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        console.error("OpenSky states fetch failed:", res.status);
        return [];
      }
      const data = await res.json();
      const states: unknown[][] = data.states ?? [];

      return states
        .filter((s) => s[5] != null && s[6] != null)
        .map(
          (s): AircraftPosition => ({
            icao24: String(s[0]),
            callsign: (String(s[1] ?? "")).trim() || String(s[0]),
            lng: Number(s[5]),
            lat: Number(s[6]),
            headingDeg: Number(s[10] ?? 0),
            altitudeFt: Math.round(Number(s[13] ?? s[7] ?? 0) * 3.28084),
            velocityKnots: Math.round(Number(s[9] ?? 0) * 1.94384),
          }),
        );
    }),
  );

  return results.flat();
}
