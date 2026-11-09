// Small shared UI bits for the maritime comparison / analytics / AI panels.
// Uses the app's existing CSS variables so it matches the rest of the dashboard.

import type { CSSProperties, ReactNode } from "react"
import type { RiskBand } from "../state/maritimeStore"

export const BAND_COLOR: Record<RiskBand, string> = {
  low: "var(--green)",
  medium: "var(--amber)",
  high: "var(--red)",
}

export const BAND_LABEL: Record<RiskBand, string> = { low: "LOW", medium: "MEDIUM", high: "HIGH" }

export const fmt = (n: number, d = 1) =>
  n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })

/** Signed number with a real minus sign, e.g. +12.3 / −4.5 / 0.0 */
export const signed = (n: number, d = 1) => {
  const rounded = Number(n.toFixed(d))
  if (rounded === 0) return fmt(0, d)
  return `${rounded > 0 ? "+" : "\u2212"}${fmt(Math.abs(rounded), d)}`
}

export const CO2 = "CO\u2082"

export function Badge({
  children,
  color = "var(--primary)",
  title,
}: {
  children: ReactNode
  color?: string
  title?: string
}) {
  return (
    <span
      title={title}
      style={{
        display: "inline-block",
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: "0.06em",
        lineHeight: 1.25,
        padding: "3px 6px",
        borderRadius: 3,
        maxWidth: "100%",
        color,
        background: `color-mix(in srgb, ${color} 13%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 35%, transparent)`,
      }}
    >
      {children}
    </span>
  )
}

export function Panel({
  children,
  style,
  accent,
}: {
  children: ReactNode
  style?: CSSProperties
  accent?: string
}) {
  return (
    <div
      style={{
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderLeft: accent ? `2px solid ${accent}` : "1px solid var(--border)",
        borderRadius: 6,
        padding: 16,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

export function Label({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: "0.1em",
        color: "var(--text-3)",
        textTransform: "uppercase",
        marginBottom: 4,
      }}
    >
      {children}
    </div>
  )
}

export function ActionButton({
  children,
  onClick,
  active,
  disabled,
  tone = "primary",
}: {
  children: ReactNode
  onClick?: () => void
  active?: boolean
  disabled?: boolean
  tone?: "primary" | "muted"
}) {
  const c = tone === "primary" ? "var(--primary)" : "var(--text-2)"
  return (
    <button
      type="button"
      className="mc-btn"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "6px 12px",
        fontSize: 10,
        fontFamily: "DM Mono, monospace",
        fontWeight: 600,
        letterSpacing: "0.06em",
        color: active ? "#000" : c,
        background: active ? c : `color-mix(in srgb, ${c} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${c} 40%, transparent)`,
        borderRadius: 4,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  )
}

/** Risk bar with a tick at the safety threshold. */
export function ThresholdBar({
  score,
  threshold,
  color,
}: {
  score: number
  threshold: number
  color: string
}) {
  return (
    <div
      role="img"
      aria-label={`Risk score ${score} out of 100; safety threshold ${threshold}`}
      style={{ position: "relative", height: 6, background: "#1a2d42", borderRadius: 3 }}
    >
      <div
        style={{
          width: `${Math.min(100, Math.max(0, score))}%`,
          height: "100%",
          background: color,
          borderRadius: 3,
        }}
      />
      <div
        title={`Safety threshold ${threshold}`}
        style={{
          position: "absolute",
          left: `${threshold}%`,
          top: -3,
          bottom: -3,
          width: 1.5,
          background: "var(--text)",
          opacity: 0.7,
        }}
      />
    </div>
  )
}

export function Shimmer({ height = 80 }: { height?: number }) {
  return (
    <div
      className="mc-shimmer"
      style={{
        height,
        borderRadius: 6,
        background: "linear-gradient(90deg, #111826 0%, #1a2638 50%, #111826 100%)",
        backgroundSize: "200% 100%",
        animation: "shimmer 1.4s ease infinite",
      }}
    />
  )
}

export function Banner({
  tone,
  children,
}: {
  tone: "warn" | "error" | "info"
  children: ReactNode
}) {
  const c = tone === "error" ? "var(--red)" : tone === "warn" ? "var(--amber)" : "var(--primary)"
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      style={{
        padding: "10px 12px",
        borderRadius: 6,
        fontSize: 11,
        lineHeight: 1.5,
        color: "var(--text)",
        background: `color-mix(in srgb, ${c} 10%, transparent)`,
        border: `1px solid color-mix(in srgb, ${c} 35%, transparent)`,
      }}
    >
      {children}
    </div>
  )
}
