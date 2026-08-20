// src/map/MapPage.tsx

import { useEffect, useMemo } from "react";
import {
  MapContainer,
  TileLayer,
  Polyline,
  CircleMarker,
  Popup,
  Tooltip,
  useMap,
} from "react-leaflet";
import type { LatLngExpression } from "leaflet";
import "leaflet/dist/leaflet.css";

import {
  useVessels,
  useAircraft,
  useRiskCorridors,
} from "../hooks/useLiveData";

type Severity = "critical" | "high" | "medium" | "low";

function buildGraticule(): LatLngExpression[][] {
  const lines: LatLngExpression[][] = [];

  for (let lng = -180; lng <= 180; lng += 30) {
    lines.push([
      [-85, lng],
      [85, lng],
    ]);
  }

  for (let lat = -60; lat <= 60; lat += 30) {
    lines.push([
      [lat, -180],
      [lat, 180],
    ]);
  }

  return lines;
}

/**
 * Forces Leaflet to recalculate its container size after mount (and on
 * window resize). Needed because react-leaflet reads the container's
 * dimensions at mount time — if the parent's layout hasn't settled yet
 * (e.g. a smaller dashboard panel vs. the full-page Live Map), the map
 * can render at the wrong size or blank until manually invalidated.
 */
function InvalidateMapSize() {
  const map = useMap();

  useEffect(() => {
    const invalidate = () => map.invalidateSize();

    invalidate();
    const settleTimer = setTimeout(invalidate, 100);

    window.addEventListener("resize", invalidate);
    return () => {
      clearTimeout(settleTimer);
      window.removeEventListener("resize", invalidate);
    };
  }, [map]);

  return null;
}

/**
 * The actual Leaflet map: tiles, graticule, risk corridors, live vessel/
 * aircraft markers, title/status/legend overlays. Reusable — fills
 * whatever parent container it's placed inside (width/height 100%,
 * minHeight 0, so it works in both the full-page Live Map and the
 * smaller Dashboard map panel).
 */
export function LiveMapCanvas() {
  const { data: vessels, loading: vesselsLoading } = useVessels();
  const {
    data: aircraft,
    loading: aircraftLoading,
    error: aircraftError,
  } = useAircraft();

  const { data: corridors, loading: corridorsLoading } =
    useRiskCorridors();

  const graticule = useMemo(buildGraticule, []);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        minHeight: 0,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Map title */}
      <div
        style={{
          position: "absolute",
          zIndex: 1000,
          top: 12,
          left: 12,
          padding: "5px 10px",
          background: "rgba(7,10,17,0.92)",
          border: "1px solid var(--border)",
          borderRadius: 4,
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: "0.1em",
          color: "var(--text-3)",
        }}
      >
        LIVE MAP · INDIA TRADE CORRIDORS
      </div>

      {/* Live status */}
      <div
        style={{
          position: "absolute",
          zIndex: 1000,
          top: 12,
          right: 12,
          display: "flex",
          gap: 8,
          alignItems: "center",
        }}
      >
        <div
          style={{
            padding: "4px 8px",
            background: "rgba(7,10,17,0.9)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "#22c55e",
              display: "inline-block",
            }}
          />

          <span
            className="mono"
            style={{
              fontSize: 8,
              color: "#22c55e",
            }}
          >
            LIVE
          </span>
        </div>

        {(vesselsLoading || aircraftLoading || corridorsLoading) && (
          <div
            className="mono"
            style={{
              padding: "4px 8px",
              background: "rgba(7,10,17,0.9)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              fontSize: 8,
              color: "var(--text-3)",
            }}
          >
            SYNCING DATA…
          </div>
        )}
      </div>

      {/* Legend */}
      <div
        style={{
          position: "absolute",
          zIndex: 1000,
          bottom: 14,
          left: 14,
          padding: "8px 10px",
          background: "rgba(7,10,17,0.92)",
          border: "1px solid var(--border)",
          borderRadius: 5,
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <span
          className="mono"
          style={{
            fontSize: 8,
            color: "var(--text-3)",
            fontWeight: 700,
          }}
        >
          RISK
        </span>

        {(["critical", "high", "medium", "low"] as Severity[]).map(
          (severity) => {
            const color =
              severity === "critical"
                ? "#ef4444"
                : severity === "high"
                  ? "#f59e0b"
                  : severity === "medium"
                    ? "#f97316"
                    : "#22c55e";

            return (
              <span
                key={severity}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: color,
                  }}
                />

                <span
                  className="mono"
                  style={{
                    fontSize: 8,
                    color: "var(--text-3)",
                    textTransform: "uppercase",
                  }}
                >
                  {severity}
                </span>
              </span>
            );
          }
        )}

        <span
          style={{
            width: 1,
            height: 12,
            background: "var(--border)",
          }}
        />

        <span
          className="mono"
          style={{
            fontSize: 8,
            color: "#38bdf8",
          }}
        >
          ● VESSELS {vessels.length}
        </span>

        <span
          className="mono"
          style={{
            fontSize: 8,
            color: "#a78bfa",
          }}
        >
          ● AIRCRAFT {aircraft.length}
        </span>
      </div>

      {/* Error indicator */}
      {aircraftError && (
        <div
          style={{
            position: "absolute",
            zIndex: 1000,
            bottom: 14,
            right: 14,
            padding: "5px 8px",
            background: "rgba(239,68,68,0.1)",
            border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: 4,
          }}
        >
          <span
            className="mono"
            style={{
              fontSize: 8,
              color: "#ef4444",
            }}
          >
            AIRCRAFT FEED ERROR
          </span>
        </div>
      )}

      <MapContainer
        center={[15, 70]}
        zoom={3}
        minZoom={2}
        maxZoom={12}
        worldCopyJump={false}
        scrollWheelZoom={true}
        style={{
          width: "100%",
          height: "100%",
          minHeight: 0,
          background: "#07111e",
        }}
      >
        <InvalidateMapSize />

        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; OpenStreetMap contributors &copy; CARTO'
        />

        {/* Graticule */}
        {graticule.map((line, i) => (
          <Polyline
            key={`grid-${i}`}
            positions={line}
            pathOptions={{
              color: "#334155",
              weight: 1,
              opacity: 0.22,
            }}
          />
        ))}

        {/* Risk corridors */}
        {corridors.map((corridor) => {
          const color =
            corridor.severity === "critical"
              ? "#ef4444"
              : corridor.severity === "high"
                ? "#f59e0b"
                : corridor.severity === "medium"
                  ? "#f97316"
                  : "#22c55e";

          return (
            <Polyline
              key={corridor.id}
              positions={corridor.path}
              pathOptions={{
                color,
                weight: 3,
                opacity: 0.8,
                dashArray: "8 8",
              }}
            >
              <Tooltip sticky>
                <strong>{corridor.name}</strong>
                <br />
                Risk: {corridor.severity.toUpperCase()}
              </Tooltip>
            </Polyline>
          );
        })}

        {/* Live vessels */}
        {vessels.map((vessel) => (
          <CircleMarker
            key={`vessel-${vessel.mmsi}`}
            center={[vessel.lat, vessel.lng]}
            radius={6}
            pathOptions={{
              color: "#075985",
              weight: 1.5,
              fillColor: "#38bdf8",
              fillOpacity: 0.95,
            }}
          >
            <Popup>
              <div style={{ minWidth: 150 }}>
                <strong>{vessel.name}</strong>

                <div>MMSI: {vessel.mmsi}</div>

                <div>
                  Speed: {vessel.speedKnots.toFixed(1)} kn
                </div>

                <div>
                  Heading: {Math.round(vessel.heading)}°
                </div>

                {vessel.destination && (
                  <div>
                    Destination: {vessel.destination}
                  </div>
                )}
              </div>
            </Popup>
          </CircleMarker>
        ))}

        {/* Live aircraft */}
        {aircraft.map((plane) => (
          <CircleMarker
            key={`aircraft-${plane.icao24}`}
            center={[plane.lat, plane.lng]}
            radius={5}
            pathOptions={{
              color: "#5b21b6",
              weight: 1.5,
              fillColor: "#a78bfa",
              fillOpacity: 0.95,
            }}
          >
            <Popup>
              <div style={{ minWidth: 150 }}>
                <strong>{plane.callsign}</strong>

                <div>ICAO24: {plane.icao24}</div>

                <div>
                  Altitude: {plane.altitudeFt.toLocaleString()} ft
                </div>

                <div>
                  Speed: {plane.velocityKnots} kn
                </div>

                <div>
                  Heading: {Math.round(plane.headingDeg)}°
                </div>
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}

/**
 * Full Live Map page: LiveMapCanvas plus the right-side alert panel.
 * Unchanged in structure/behavior from before the refactor.
 */
export default function MapPage() {
  const { data: vessels } = useVessels();
  const { data: aircraft } = useAircraft();

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        minWidth: 0,
        minHeight: 0,
        height: "100%",
        overflow: "hidden",
        background: "var(--bg)",
      }}
    >
      {/* MAP */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          position: "relative",
          overflow: "hidden",
        }}
      >
        <LiveMapCanvas />
      </div>

      {/* RIGHT ALERT PANEL */}
      <div
        style={{
          width: 260,
          borderLeft: "1px solid var(--border)",
          background: "var(--panel)",
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            padding: "10px 14px",
            borderBottom: "1px solid var(--border)",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.1em",
            color: "var(--text-3)",
            textTransform: "uppercase",
          }}
        >
          Active Events
        </div>

        {/* Feed summary */}
        <div
          style={{
            padding: "10px 14px",
            borderTop: "1px solid var(--border)",
          }}
        >
          <div
            className="mono"
            style={{
              fontSize: 8,
              color: "var(--text-3)",
              marginBottom: 5,
            }}
          >
            LIVE DATA SOURCES
          </div>

          <div
            className="mono"
            style={{
              fontSize: 8,
              color: "#38bdf8",
              marginBottom: 3,
            }}
          >
            AISSTREAM · {vessels.length} VESSELS
          </div>

          <div
            className="mono"
            style={{
              fontSize: 8,
              color: "#a78bfa",
            }}
          >
            OPENSKY · {aircraft.length} AIRCRAFT
          </div>
        </div>
      </div>
    </div>
  );
}
