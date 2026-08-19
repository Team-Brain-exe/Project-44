// src/map/MapPage.tsx
import { useMemo } from "react";
import { MapContainer, TileLayer, Polyline, CircleMarker, Popup, Tooltip } from "react-leaflet";
import type { LatLngExpression } from "leaflet";
import "leaflet/dist/leaflet.css";
import { useVessels, useAircraft, useRiskCorridors } from "../hooks/useLiveData";

// ---------------------------------------------------------------------------
// Severity color scale — reuse this exact mapping anywhere else severity
// needs a color (alerts panel, legend, etc.) so it stays consistent.
// ---------------------------------------------------------------------------
const SEVERITY_COLOR: Record<string, string> = {
  critical: "#ef4444",
  high: "#f97316",
  medium: "#eab308",
  low: "#22c55e",
};

// ---------------------------------------------------------------------------
// Graticule: lat/long grid lines every 30°, so the map reads as a real
// world map at a glance rather than a cropped, ambiguous region.
// ---------------------------------------------------------------------------
function buildGraticule(): LatLngExpression[][] {
  const lines: LatLngExpression[][] = [];
  for (let lng = -180; lng <= 180; lng += 30) {
    lines.push([[-85, lng], [85, lng]]);
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    lines.push([[lat, -180], [lat, 180]]);
  }
  return lines;
}

export default function MapPage() {
  const { data: vessels, loading: vesselsLoading } = useVessels();
  const { data: aircraft, loading: aircraftLoading } = useAircraft();
  const { data: corridors } = useRiskCorridors();

  const graticule = useMemo(buildGraticule, []);

  return (
    <div className="relative w-full h-full min-h-[520px] rounded-xl overflow-hidden border border-neutral-800 bg-neutral-950">
      {/* Legend */}
      <div className="absolute z-[500] top-3 left-3 flex items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-950/85 backdrop-blur px-3 py-2 text-xs text-neutral-300">
        <span className="font-medium text-neutral-100 mr-1">Severity</span>
        {Object.entries(SEVERITY_COLOR).map(([level, color]) => (
          <span key={level} className="flex items-center gap-1.5 capitalize">
            <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: color }} />
            {level}
          </span>
        ))}
        <span className="w-px h-3 bg-neutral-700 mx-1" />
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full inline-block bg-sky-400" />
          Vessel
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full inline-block bg-violet-400" />
          Aircraft
        </span>
      </div>

      {/* Loading indicator (mock data resolves instantly, but real fetches won't) */}
      {(vesselsLoading || aircraftLoading) && (
        <div className="absolute z-[500] top-3 right-3 rounded-lg border border-neutral-800 bg-neutral-950/85 px-3 py-1.5 text-xs text-neutral-400">
          Loading live positions…
        </div>
      )}

      <MapContainer
        center={[15, 50]}
        zoom={2}
        minZoom={2}
        worldCopyJump
        scrollWheelZoom
        className="w-full h-full min-h-[520px]"
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
        />

        {/* Lat/long grid */}
        {graticule.map((line, i) => (
          <Polyline
            key={`grid-${i}`}
            positions={line}
            pathOptions={{ color: "#3f3f46", weight: 1, opacity: 0.35 }}
          />
        ))}

        {/* Risk corridors, colored by severity */}
        {corridors.map((corridor) => (
          <Polyline
            key={corridor.id}
            positions={corridor.path}
            pathOptions={{
              color: SEVERITY_COLOR[corridor.severity] ?? "#94a3b8",
              weight: 3,
              opacity: 0.85,
            }}
          >
            <Tooltip sticky>
              {corridor.name} — {corridor.severity}
            </Tooltip>
          </Polyline>
        ))}

        {/* Live vessels */}
        {vessels.map((v) => (
          <CircleMarker
            key={v.mmsi}
            center={[v.lat, v.lng]}
            radius={5}
            pathOptions={{ color: "#0c4a6e", weight: 1, fillColor: "#38bdf8", fillOpacity: 0.95 }}
          >
            <Popup>
              <div className="text-sm">
                <strong>{v.name}</strong>
                <div>MMSI: {v.mmsi}</div>
                <div>Speed: {v.speedKnots} kn</div>
                <div>Heading: {v.heading}°</div>
                {v.destination && <div>Destination: {v.destination}</div>}
              </div>
            </Popup>
          </CircleMarker>
        ))}

        {/* Live aircraft */}
        {aircraft.map((a) => (
          <CircleMarker
            key={a.icao24}
            center={[a.lat, a.lng]}
            radius={4}
            pathOptions={{ color: "#4c1d95", weight: 1, fillColor: "#a78bfa", fillOpacity: 0.95 }}
          >
            <Popup>
              <div className="text-sm">
                <strong>{a.callsign}</strong>
                <div>ICAO24: {a.icao24}</div>
                <div>Altitude: {a.altitudeFt.toLocaleString()} ft</div>
                <div>Speed: {a.velocityKnots} kn</div>
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
