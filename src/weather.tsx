// src/weather.tsx
//
// Turns existing alert data into visible ocean/air weather hazards:
//   - classifyWeather() reads an alert's type + summary and buckets it into
//     rain / storm(+thunder) / flood(water-level rise) — no new backend
//     fields needed, it works off what's already in AlertEvent.
//   - WeatherIcon / WeatherBadge render a small animated icon for alert rows.
//   - WeatherHazardMarkers drops animated markers on the Leaflet map at the
//     affected port/strait, so the hazard is visible on the map itself, not
//     just in a list.

import { Marker, Tooltip } from "react-leaflet"
import L from "leaflet"

export type WeatherKind = "rain" | "storm" | "flood" | null

export type WeatherAlertLike = {
  type: string
  summary?: string
  location: string
}

// Mirrors backend/data/seed.py's PORTS table so hazard markers land on the
// right chokepoint on the map without needing a backend round-trip.
export const LOCATION_COORDS: Record<string, [number, number]> = {
  "Suez Canal": [30.5852, 32.2654],
  "Panama Canal": [9.08, -79.68],
  "Strait of Hormuz": [26.5667, 56.25],
  "Strait of Malacca": [2.5, 101.5],
  "Port of Singapore": [1.2644, 103.82],
  "Singapore": [1.2644, 103.82],
  "Rotterdam": [51.9496, 4.1453],
  "Port of Rotterdam": [51.9496, 4.1453],
  "Port of Shanghai": [31.2304, 121.4737],
  "Shanghai": [31.2304, 121.4737],
  "Jawaharlal Nehru Port (JNPT)": [18.949, 72.9525],
  "JNPT": [18.949, 72.9525],
  "Mumbai": [18.949, 72.9525],
  "Port of Los Angeles": [33.7395, -118.261],
  "Los Angeles": [33.7395, -118.261],
  "Port of Jebel Ali": [25.0118, 55.0618],
  "Jebel Ali": [25.0118, 55.0618],
}

export function coordsForLocation(location: string): [number, number] | null {
  if (LOCATION_COORDS[location]) return LOCATION_COORDS[location]
  const key = Object.keys(LOCATION_COORDS).find(k => location.includes(k) || k.includes(location))
  return key ? LOCATION_COORDS[key] : null
}

// Order matters: flood-language is checked before storm/rain so "storm
// surge" and "monsoon flood" land on "flood" (water-level rise) rather than
// generic "storm". Deliberately does NOT match on "water level" alone —
// e.g. Panama's "low water levels" drought/congestion alert is the opposite
// of a rise and should stay unclassified.
export function classifyWeather(a: WeatherAlertLike): WeatherKind {
  const text = `${a.type} ${a.summary ?? ""}`.toLowerCase()
  if (/flood|storm surge|monsoon|inundat|rising (river|water)/.test(text)) return "flood"
  if (/cyclone|storm|thunder|lightning|typhoon|hurricane/.test(text)) return "storm"
  if (/weather|rain|precipitation|fog/.test(text)) return "rain"
  return null
}

const KIND_META: Record<Exclude<WeatherKind, null>, { color: string; label: string }> = {
  rain: { color: "#38bdf8", label: "RAIN" },
  storm: { color: "#a78bfa", label: "STORM · THUNDER" },
  flood: { color: "#f59e0b", label: "WATER LEVEL RISE" },
}

export function weatherLabel(kind: WeatherKind): string {
  return kind ? KIND_META[kind].label : ""
}

// Small inline animated icon — used standalone or inside WeatherBadge.
export function WeatherIcon({ kind, size = 14 }: { kind: WeatherKind; size?: number }) {
  if (!kind) return null
  const meta = KIND_META[kind]
  return (
    <span style={{ display: "inline-flex", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        {kind === "rain" && (
          <>
            <path
              d="M6 11a4 4 0 0 1 .7-7.94A5.5 5.5 0 0 1 17.2 6.2 4 4 0 0 1 17 14H7a4 4 0 0 1-1-3z"
              fill={meta.color}
              opacity="0.85"
            />
            <line x1="8" y1="16" x2="7" y2="20" stroke={meta.color} strokeWidth="1.6" strokeLinecap="round" className="weather-rain-drop" style={{ animationDelay: "0s" }} />
            <line x1="12" y1="16" x2="11" y2="21" stroke={meta.color} strokeWidth="1.6" strokeLinecap="round" className="weather-rain-drop" style={{ animationDelay: "0.25s" }} />
            <line x1="16" y1="16" x2="15" y2="20" stroke={meta.color} strokeWidth="1.6" strokeLinecap="round" className="weather-rain-drop" style={{ animationDelay: "0.5s" }} />
          </>
        )}
        {kind === "storm" && (
          <>
            <path
              d="M6 10a4 4 0 0 1 .7-7.94A5.5 5.5 0 0 1 17.2 5.2 4 4 0 0 1 17 13H7a4 4 0 0 1-1-3z"
              fill={meta.color}
              opacity="0.85"
            />
            <path d="M12.5 12 9 18h3l-1 4 4.5-7h-3l1-3z" fill="#fbbf24" className="weather-lightning" />
          </>
        )}
        {kind === "flood" && (
          <>
            <path d="M12 3c1.8 2.4 3 4.2 3 6a3 3 0 1 1-6 0c0-1.8 1.2-3.6 3-6z" fill={meta.color} opacity="0.85" className="weather-rise" />
            <path d="M3 14c1.5 1.2 2.5 1.2 4 0s2.5-1.2 4 0 2.5 1.2 4 0 2.5-1.2 4 0" stroke={meta.color} strokeWidth="1.6" fill="none" strokeLinecap="round" />
            <path d="M3 18c1.5 1.2 2.5 1.2 4 0s2.5-1.2 4 0 2.5 1.2 4 0 2.5-1.2 4 0" stroke={meta.color} strokeWidth="1.6" fill="none" strokeLinecap="round" opacity="0.55" />
          </>
        )}
      </svg>
    </span>
  )
}

// Icon + text pill, matching the app's existing mono badge style — drop this
// next to the severity/type badges on an alert row.
export function WeatherBadge({ kind }: { kind: WeatherKind }) {
  if (!kind) return null
  const meta = KIND_META[kind]
  return (
    <span
      className="mono"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        fontSize: 8,
        fontWeight: 600,
        letterSpacing: "0.06em",
        padding: "1px 5px 1px 3px",
        borderRadius: 3,
        background: `${meta.color}18`,
        color: meta.color,
        border: `1px solid ${meta.color}40`,
        whiteSpace: "nowrap",
      }}
    >
      <WeatherIcon kind={kind} size={11} />
      {meta.label}
    </span>
  )
}

function weatherDivIcon(kind: Exclude<WeatherKind, null>) {
  const meta = KIND_META[kind]
  const inner =
    kind === "rain"
      ? `<div class="weather-marker-core" style="background:${meta.color};box-shadow:0 0 8px ${meta.color}"></div>
         <div class="weather-marker-rain" style="border-color:${meta.color}"></div>`
      : kind === "storm"
      ? `<div class="weather-marker-core weather-marker-flash" style="background:${meta.color};box-shadow:0 0 8px ${meta.color}"></div>
         <div class="weather-marker-bolt">⚡</div>`
      : `<div class="weather-marker-core" style="background:${meta.color};box-shadow:0 0 8px ${meta.color}"></div>
         <div class="weather-marker-ring" style="border-color:${meta.color}"></div>
         <div class="weather-marker-ring weather-marker-ring-delay" style="border-color:${meta.color}"></div>`

  return L.divIcon({
    className: "weather-marker",
    html: `<div class="weather-marker-wrap">${inner}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  })
}

export type WeatherEvent = {
  id: string | number
  location: string
  kind: Exclude<WeatherKind, null>
  label: string
  detail: string
}
// Derives the set of map-able weather hazards from a list of alerts (any
// shape with type/summary/location — AlertEvent satisfies this).
export function weatherEventsFromAlerts<T extends WeatherAlertLike & { id: string | number; dismissed?: boolean }>(
  alerts: T[]
): WeatherEvent[] {
  return alerts
    .filter(a => !a.dismissed)
    .map(a => {
      const kind = classifyWeather(a)
      if (!kind) return null
      return { id: a.id, location: a.location, kind, label: weatherLabel(kind), detail: a.summary ?? "" }
    })
    .filter((e): e is WeatherEvent => e !== null)
}

// Animated hazard markers, dropped straight into a react-leaflet <MapContainer>.
export function WeatherHazardMarkers({ events }: { events: WeatherEvent[] }) {
  return (
    <>
      {events.map(ev => {
        const coords = coordsForLocation(ev.location)
        if (!coords) return null
        return (
          <Marker key={`weather-${ev.id}`} position={coords} icon={weatherDivIcon(ev.kind)}>
            <Tooltip direction="top" offset={[0, -10]}>
              <strong>{ev.label}</strong>
              <br />
              {ev.location}
            </Tooltip>
          </Marker>
        )
      })}
    </>
  )
}

// ─── Per-route weather report ──────────────────────────────────────────────
//
// Matches alerts onto a specific route so a route card can show "here's the
// weather sitting on this lane" rather than making someone cross-reference
// the Alerts page. Mirrors the matching rule already used for ML risk
// scoring (backend/data/seed.py comment + computeRiskScore in App.tsx):
// an alert's `route` text is checked against "{from} - {to}" first, then
// falls back to matching the route's `via` chokepoint, then the alert's
// raw location as a last resort (so a landed alert on the same chokepoint
// still shows even if the route text wasn't set consistently).
export type RouteLike = { from: string; to: string; via: string }

export function weatherForRoute<
  T extends WeatherAlertLike & { id: string | number; route: string; dismissed?: boolean }
>(route: RouteLike, alerts: T[]): WeatherEvent[] {
  const routeKey = `${route.from} - ${route.to}`
  return alerts
    .filter(a => !a.dismissed)
    .filter(a => a.route === routeKey || a.route === route.via || a.location === route.via)
    .map(a => {
      const kind = classifyWeather(a)
      if (!kind) return null
      return { id: a.id, location: a.location, kind, label: weatherLabel(kind), detail: a.summary ?? "" }
    })
    .filter((e): e is WeatherEvent => e !== null)
}

// Compact weather report for a single route row: a run of hazard badges if
// anything is live on that lane, or a quiet "no weather hazards" line if
// clear — so the status is visible either way, not just when there's bad news.
export function RouteWeatherReport({ events }: { events: WeatherEvent[] }) {
  if (events.length === 0) {
    return (
      <div
        className="mono"
        style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 8, color: "var(--text-3)", marginTop: 4 }}
      >
        <span style={{ color: "#22c55e" }}>✓</span> NO WEATHER HAZARDS
      </div>
    )
  }
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }} title={events.map(e => `${e.location}: ${e.detail}`).join("\n")}>
      {events.map(ev => (
        <WeatherBadge key={`rw-${ev.id}`} kind={ev.kind} />
      ))}
    </div>
  )
}
