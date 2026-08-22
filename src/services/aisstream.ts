//
// Client-side WebSocket to AISstream.io. No backend to route this through,
// so the connection and API key live here in the browser. Fine for a demo —
// if this ever ships for real, move this behind a server so the key isn't public.
//
// Falls back to simulated vessels along the same watched corridors if no
// real AIS data arrives within a few seconds (missing/invalid API key,
// connection failure, or just no traffic in the bounding boxes right now)
// — so the map's vessel layer is never empty for a demo. Simulated entries
// are clearly labeled with a "SIM·" name prefix.

import type { VesselPosition } from "./liveData";

const AISSTREAM_WS_URL = "wss://stream.aisstream.io/v0/stream";
const API_KEY = import.meta.env.VITE_AISSTREAM_API_KEY as string | undefined;
const FALLBACK_DELAY_MS = 5000;

// [[southWestLat, southWestLng], [northEastLat, northEastLng]]
const WATCHED_BOUNDING_BOXES: [[number, number], [number, number]][] = [
  [[5, 20], [35, 60]],   // Red Sea / Gulf of Aden / Suez approach / wider Arabian Sea
  [[-5, 90], [15, 115]], // Strait of Malacca / Singapore / South China Sea approach
  [[0, 55], [28, 95]],   // Indian coastline + Arabian Sea + Bay of Bengal
];

// Simulated shipping lanes, used as a fallback when no real AIS data arrives.
const SIMULATED_ROUTES: {
  mmsi: string;
  name: string;
  waypoints: [number, number][];
  speedKnots: number;
  periodSec: number;
}[] = [
  {
    mmsi: "sim-001",
    name: "SIM·EVER GIVEN II",
    waypoints: [[29.9, 32.5], [20.0, 38.5], [12.5, 45.0], [15.0, 51.0]], // Suez -> Red Sea -> Gulf of Aden
    speedKnots: 16,
    periodSec: 400,
  },
  {
    mmsi: "sim-002",
    name: "SIM·MAERSK MALACCA",
    waypoints: [[1.3, 103.8], [3.0, 100.5], [6.0, 97.0], [13.0, 92.0]], // Singapore -> Malacca -> Andaman Sea
    speedKnots: 18,
    periodSec: 450,
  },
  {
    mmsi: "sim-003",
    name: "SIM·JNPT VOYAGER",
    waypoints: [[18.9, 72.8], [15.0, 70.0], [10.0, 65.0], [6.9, 79.8]], // Mumbai -> Arabian Sea -> Colombo
    speedKnots: 15,
    periodSec: 420,
  },
  {
    mmsi: "sim-004",
    name: "SIM·COLOMBO EXPRESS",
    waypoints: [[6.9, 79.8], [4.0, 82.0], [3.0, 88.0], [1.3, 103.8]], // Colombo -> Bay of Bengal -> Singapore
    speedKnots: 17,
    periodSec: 440,
  },
];

type Listener = (vessels: VesselPosition[]) => void;

let socket: WebSocket | null = null;
const vesselCache = new Map<string, VesselPosition>();
const listeners = new Set<Listener>();
let refCount = 0;
let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
let simInterval: ReturnType<typeof setInterval> | null = null;
let usingFallback = false;

function notifyListeners() {
  const snapshot = Array.from(vesselCache.values());
  listeners.forEach((fn) => fn(snapshot));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function bearing(lat1: number, lng1: number, lat2: number, lng2: number) {
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos((lat2 * Math.PI) / 180);
  const x =
    Math.cos((lat1 * Math.PI) / 180) * Math.sin((lat2 * Math.PI) / 180) -
    Math.sin((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function simulatedPosition(route: (typeof SIMULATED_ROUTES)[number], now: number): VesselPosition {
  const n = route.waypoints.length;
  const progress = ((now % route.periodSec) / route.periodSec) * (n - 1);
  let i = Math.floor(progress);
  const t = progress - i;
  i = Math.min(i, n - 2);

  const [lat1, lng1] = route.waypoints[i];
  const [lat2, lng2] = route.waypoints[i + 1];
  const lat = lerp(lat1, lat2, t);
  const lng = lerp(lng1, lng2, t);
  const heading = bearing(lat1, lng1, lat2, lng2);

  return {
    mmsi: route.mmsi,
    name: route.name,
    lat,
    lng,
    heading,
    speedKnots: route.speedKnots,
  };
}

function startFallback() {
  if (usingFallback) return;
  usingFallback = true;
  console.warn("[aisstream] No real vessel data received, using simulated fallback.");

  const tick = () => {
    const now = Date.now() / 1000;
    SIMULATED_ROUTES.forEach((route) => {
      vesselCache.set(route.mmsi, simulatedPosition(route, now));
    });
    notifyListeners();
  };

  tick();
  simInterval = setInterval(tick, 2000);
}

function stopFallback() {
  if (simInterval) {
    clearInterval(simInterval);
    simInterval = null;
  }
  usingFallback = false;
}

function connect() {
  if (socket || !API_KEY) {
    if (!API_KEY) startFallback();
    return;
  }

  socket = new WebSocket(AISSTREAM_WS_URL);

  socket.onopen = () => {
    socket?.send(
      JSON.stringify({
        APIKey: API_KEY,
        BoundingBoxes: WATCHED_BOUNDING_BOXES,
        FilterMessageTypes: ["PositionReport"],
      }),
    );
  };

  socket.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.MessageType !== "PositionReport") return;

      const report = msg.Message?.PositionReport;
      const meta = msg.MetaData;
      if (!report || !meta) return;

      // Real data arrived — cancel the fallback path if it was pending/active.
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
      if (usingFallback) {
        stopFallback();
        vesselCache.clear();
      }

      const mmsi = String(meta.MMSI);
      vesselCache.set(mmsi, {
        mmsi,
        name: meta.ShipName?.trim() || `MMSI ${mmsi}`,
        lat: report.Latitude,
        lng: report.Longitude,
        heading: report.TrueHeading ?? report.Cog ?? 0,
        speedKnots: report.Sog ?? 0,
      });

      notifyListeners();
    } catch {
      // AIS streams are noisy — ignore malformed frames rather than crash.
    }
  };

  socket.onclose = () => {
    socket = null;
    if (refCount > 0) {
      setTimeout(connect, 3000); // basic auto-reconnect
    }
  };

  socket.onerror = () => {
    // onclose will fire right after; fallback timer (already running) handles the rest.
  };

  // If no real position report arrives within FALLBACK_DELAY_MS, show simulated vessels.
  if (!fallbackTimer) {
    fallbackTimer = setTimeout(() => {
      if (vesselCache.size === 0) startFallback();
    }, FALLBACK_DELAY_MS);
  }
}

function disconnect() {
  socket?.close();
  socket = null;
  if (fallbackTimer) {
    clearTimeout(fallbackTimer);
    fallbackTimer = null;
  }
  stopFallback();
}

/** Subscribe to live vessel updates. Call the returned function to unsubscribe. */
export function subscribeToVessels(listener: Listener): () => void {
  listeners.add(listener);
  refCount += 1;

  if (!API_KEY) {
    console.warn(
      "VITE_AISSTREAM_API_KEY is not set — get a free key at aisstream.io and add it to .env. Using simulated vessels instead.",
    );
    startFallback();
  } else {
    connect();
  }
  listener(Array.from(vesselCache.values())); // hand back whatever's cached already

  return () => {
    listeners.delete(listener);
    refCount -= 1;
    if (refCount <= 0) disconnect();
  };
}
