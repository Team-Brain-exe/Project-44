// Aircraft feed, now proxied through our own backend. The backend holds
// the OpenSky OAuth2 client credentials and calls OpenSky server-to-server,
// avoiding the CORS block on the token endpoint and keeping the client
// secret out of the browser bundle.

import type { AircraftPosition } from "./liveData";
import { BACKEND_URL } from "./project44";

/** Fetch current aircraft states via our backend's /aircraft/live proxy. */
export async function fetchOpenSkyAircraft(): Promise<AircraftPosition[]> {
  const res = await fetch(`${BACKEND_URL}/aircraft/live`);
  if (!res.ok) {
    console.error("Aircraft feed fetch failed:", res.status);
    return [];
  }
  return (await res.json()) as AircraftPosition[];
}
