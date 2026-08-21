// Talks to the real Project44 backend (FastAPI) and adapts its response
// shapes into the types App.tsx already expects. This is the one place
// that should know both shapes — nothing else in the frontend should.

export const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? "http://localhost:8000";

// ─── Backend response shapes (mirrors app/schemas/*.py) ──────────────────────

export type BackendAlert = {
  id: number;
  time: string;
  type: string;
  location: string;
  route: string;
  severity: number; // 1-5
  summary: string;
  age_min: number;
  dismissed: boolean;
};

export type BackendRoute = {
  id: number;
  origin: string;
  destination: string;
  via: string;
  risk: string; // "low" | "medium" | "high"
  score: number; // 0-100
  status: string;
  freight: number;
  delay: number;
  watched: boolean;
};

export type BackendReroute = {
  id: number;
  original_route_id: number | null;
  alt: string;
  via: string;
  extra_days: number;
  extra_cost: number;
  confidence: number; // 0-1
  reason: string;
  applied: boolean;
  dismissed: boolean;
};

// ─── Frontend shapes (must match App.tsx's own types) ────────────────────────

type Severity = "critical" | "high" | "medium" | "low";

export type AlertEvent = {
  id: number;
  time: string;
  type: string;
  location: string;
  route: string;
  severity: Severity;
  summary: string;
  ageMin: number;
  dismissed?: boolean;
};

export type FrontendRoute = {
  id: string;
  from: string;
  to: string;
  via: string;
  risk: Severity;
  score: number;
  status: string;
  freight: string;
  delay: string;
  watched: boolean;
};

export type FrontendReroute = {
  id: number;
  original: string;
  alt: string;
  via: string;
  extraDays: number;
  extraCost: string;
  confidence: number;
  reason: string;
  applied?: boolean;
  dismissed?: boolean;
};

// ─── Adapters ──────────────────────────────────────────────────────────────

function severityFromInt(n: number): Severity {
  if (n >= 5) return "critical";
  if (n >= 4) return "high";
  if (n >= 3) return "medium";
  return "low";
}

// Backend only knows low/medium/high (see risk_scoring.py thresholds).
// "critical" is a frontend-only concept, reserved for score >= 85.
function riskFromBackend(risk: string, score: number): Severity {
  if (score >= 85) return "critical";
  if (risk === "high") return "high";
  if (risk === "medium") return "medium";
  return "low";
}

export function adaptAlert(a: BackendAlert): AlertEvent {
  return {
    id: a.id,
    time: a.time,
    type: a.type.toUpperCase(),
    location: a.location,
    route: a.route.replace(" - ", " → "),
    severity: severityFromInt(a.severity),
    summary: a.summary,
    ageMin: a.age_min,
    dismissed: a.dismissed,
  };
}

export function adaptRoute(r: BackendRoute): FrontendRoute {
  return {
    id: String(r.id),
    from: r.origin,
    to: r.destination,
    via: r.via,
    risk: riskFromBackend(r.risk, r.score),
    score: Math.round(r.score),
    status: r.status.toUpperCase(),
    freight: `$${r.freight.toLocaleString()}M`,
    delay: r.delay > 0 ? `+${r.delay}d` : "—",
    watched: r.watched,
  };
}

export function adaptReroute(
  rr: BackendReroute,
  routesById: Map<number, BackendRoute>
): FrontendReroute {
  const orig = rr.original_route_id != null ? routesById.get(rr.original_route_id) : undefined;
  const original = orig
    ? `${orig.origin} → ${orig.destination} via ${orig.via}`
    : rr.alt.replace(" (alternate)", "");

  return {
    id: rr.id,
    original,
    alt: rr.alt,
    via: rr.via,
    extraDays: rr.extra_days,
    extraCost: `+$${rr.extra_cost.toLocaleString()}`,
    confidence: Math.round(rr.confidence * 100),
    reason: rr.reason,
    applied: rr.applied,
    dismissed: rr.dismissed,
  };
}

// ─── Fetchers ──────────────────────────────────────────────────────────────

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`);
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return res.json();
}

async function patchJSON<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return res.json();
}

async function postJSON<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return res.json();
}

export async function fetchDashboardData() {
  const [rawAlerts, rawRoutes, rawReroutes] = await Promise.all([
    getJSON<BackendAlert[]>("/alerts"),
    getJSON<BackendRoute[]>("/routes"),
    getJSON<BackendReroute[]>("/reroutes"),
  ]);

  const routesById = new Map(rawRoutes.map(r => [r.id, r]));

  return {
    alerts: rawAlerts.map(adaptAlert),
    routes: rawRoutes.map(adaptRoute),
    reroutes: rawReroutes.map(rr => adaptReroute(rr, routesById)),
    // Kept for callers that need to re-derive things (e.g. re-adapting a
    // freshly generated reroute) without an extra round trip.
    rawRoutesById: routesById,
  };
}

export function dismissAlertApi(id: number) {
  return patchJSON<BackendAlert>(`/alerts/${id}`, { dismissed: true });
}

export function setRouteWatchedApi(id: string, watched: boolean) {
  return patchJSON<BackendRoute>(`/routes/${id}`, { watched });
}

export function applyRerouteApi(id: number) {
  return patchJSON<BackendReroute>(`/reroutes/${id}/apply`);
}

export function dismissRerouteApi(id: number) {
  return patchJSON<BackendReroute>(`/reroutes/${id}/dismiss`);
}

export function generateReroutesApi(routeId: string) {
  return postJSON<BackendReroute[]>(`/reroutes/generate/${routeId}`);
}

// ─── Notifications ─────────────────────────────────────────────────────────

export type BackendNotification = {
  id: number;
  alert_id: number | null;
  device_id: number | null;
  phone_number: string;
  message: string;
  status: string;
  detail: string | null;
};

export function notifyTeamApi(alertId: number, message: string) {
  return postJSON<BackendNotification[]>("/notifications/send", {
    alert_id: alertId,
    message,
  });
}
