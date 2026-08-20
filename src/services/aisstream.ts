
//
// Client-side WebSocket to AISstream.io. No backend to route this through,
// so the connection and API key live here in the browser. Fine for a demo —
// if this ever ships for real, move this behind a server so the key isn't public.

import type { VesselPosition } from "./liveData";

const AISSTREAM_WS_URL = "wss://stream.aisstream.io/v0/stream";
const API_KEY = import.meta.env.VITE_AISSTREAM_API_KEY as string | undefined;

// [[southWestLat, southWestLng], [northEastLat, northEastLng]]
// The chokepoints UNILOG cares about — add more boxes as needed.
const WATCHED_BOUNDING_BOXES: [[number, number], [number, number]][] = [
  [[10, 40], [32, 50]], // Red Sea / Bab-el-Mandeb / Gulf of Suez
  [[-1, 95], [8, 104]], // Strait of Malacca / Singapore
  [[8, 68], [24, 90]], // Indian coastline (JNPT, Mundra, Chennai, Kolkata, Cochin)
];

type Listener = (vessels: VesselPosition[]) => void;

let socket: WebSocket | null = null;
const vesselCache = new Map<string, VesselPosition>();
const listeners = new Set<Listener>();
let refCount = 0;

function notifyListeners() {
  const snapshot = Array.from(vesselCache.values());
  listeners.forEach((fn) => fn(snapshot));
}

function connect() {
  if (socket || !API_KEY) return;

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
}

function disconnect() {
  socket?.close();
  socket = null;
}

/** Subscribe to live vessel updates. Call the returned function to unsubscribe. */
export function subscribeToVessels(listener: Listener): () => void {
  listeners.add(listener);
  refCount += 1;

  if (!API_KEY) {
    console.warn(
      "VITE_AISSTREAM_API_KEY is not set — get a free key at aisstream.io and add it to .env",
    );
  } else {
    connect();
    listener(Array.from(vesselCache.values())); // hand back whatever's cached already
  }

  return () => {
    listeners.delete(listener);
    refCount -= 1;
    if (refCount <= 0) disconnect();
  };
}
