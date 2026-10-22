import { useEffect, useState } from "react";

const START_DATE = new Date("2023-01-01T00:00:00Z");
const END_DATE = new Date();

const START_MS = START_DATE.getTime();
const END_MS = END_DATE.getTime();
const DAY_MS = 24 * 60 * 60 * 1000;

type Severity = "critical" | "high" | "medium" | "low";

type ReplayControlsProps = {
  date: Date;
  onDateChange: (date: Date) => void;
};

function getDemoSeverity(date: Date): Severity {
  const time = date.getTime();

  if (time < Date.UTC(2023, 9, 1)) return "low";
  if (time < Date.UTC(2023, 11, 1)) return "medium";
  if (time < Date.UTC(2024, 2, 1)) return "high";
  return "critical";
}

const severityColors: Record<Severity, string> = {
  low: "#4ade80",
  medium: "#fb923c",
  high: "#fbbf24",
  critical: "#f87171",
};

export default function ReplayControls({
  date,
  onDateChange,
}: ReplayControlsProps) {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(7);

  const currentMs = Math.min(
    END_MS,
    Math.max(START_MS, date.getTime()),
  );

  const progress =
    END_MS > START_MS
      ? ((currentMs - START_MS) / (END_MS - START_MS)) * 100
      : 0;

  const formattedDate = new Date(currentMs).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

  const severity = getDemoSeverity(new Date(currentMs));

  useEffect(() => {
    if (!playing) return;

    const timer = window.setInterval(() => {
      const nextMs = Math.min(
        END_MS,
        currentMs + speed * DAY_MS,
      );

      onDateChange(new Date(nextMs));

      if (nextMs >= END_MS) setPlaying(false);
    }, 500);

    return () => window.clearInterval(timer);
  }, [playing, speed, currentMs, onDateChange]);

  const buttonStyle: React.CSSProperties = {
    padding: "6px 10px",
    border: "1px solid #294253",
    borderRadius: 5,
    background: "#132538",
    color: "#e2e8f0",
    fontSize: 11,
    fontWeight: 700,
    cursor: "pointer",
  };

  return (
    <section
      aria-label="Historical risk replay"
      style={{
        position: "absolute",
        zIndex: 1100,
        left: 12,
        right: 12,
        bottom: 64,
        maxHeight: "45%",
        overflowY: "auto",
        padding: "10px 12px",
        background: "rgba(8,17,32,0.97)",
        color: "#e2e8f0",
        border: "1px solid #234052",
        borderRadius: 7,
        boxShadow: "0 4px 18px rgba(0,0,0,0.35)",
        fontFamily: "inherit",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 7,
        }}
      >
        <div>
          <strong style={{ fontSize: 12, letterSpacing: "0.08em" }}>
            HISTORICAL RISK REPLAY
          </strong>
          <div style={{ fontSize: 10, color: "#9fb2c5", marginTop: 3 }}>
            ILLUSTRATIVE DEMO · NOT VERIFIED HISTORICAL DATA
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              color: playing ? "#4ade80" : "#9fb2c5",
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: "0.06em",
            }}
          >
            {playing ? "● PLAYING" : "Ⅱ PAUSED"}
          </span>

          <span
            style={{
              border: `1px solid ${severityColors[severity]}`,
              color: severityColors[severity],
              background: "#101d2d",
              padding: "4px 7px",
              borderRadius: 4,
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: "0.06em",
            }}
          >
            DEMO RISK: {severity.toUpperCase()}
          </span>

          <strong
            style={{
              fontFamily: "monospace",
              fontSize: 13,
              whiteSpace: "nowrap",
            }}
          >
            {formattedDate}
          </strong>
        </div>
      </div>

      <input
        aria-label="Replay date"
        type="range"
        min={START_MS}
        max={END_MS}
        step={DAY_MS}
        value={currentMs}
        onChange={(event) => {
          setPlaying(false);
          onDateChange(new Date(Number(event.target.value)));
        }}
        style={{ width: "100%", accentColor: "#36c7a5", cursor: "pointer" }}
      />

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          color: "#9fb2c5",
          fontSize: 10,
          marginTop: 2,
        }}
      >
        <span>01 JAN 2023</span>
        <span>{Math.round(progress)}% through timeline</span>
        <span>
          {END_DATE.toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "short",
            year: "numeric",
            timeZone: "UTC",
          })}
        </span>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginTop: 8,
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          onClick={() => {
            if (currentMs >= END_MS) onDateChange(START_DATE);
            setPlaying((value) => !value);
          }}
          style={buttonStyle}
        >
          {playing ? "Ⅱ Pause" : "▶ Play"}
        </button>

        <button
          type="button"
          onClick={() => {
            setPlaying(false);
            onDateChange(START_DATE);
          }}
          style={buttonStyle}
        >
          ↺ Reset
        </button>

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11,
            color: "#cbd5e1",
          }}
        >
          Playback speed
          <select
            value={speed}
            onChange={(event) => setSpeed(Number(event.target.value))}
            style={{
              padding: "5px 7px",
              border: "1px solid #294253",
              borderRadius: 5,
              background: "#132538",
              color: "#e2e8f0",
            }}
          >
            <option value={1}>1 day / step</option>
            <option value={3}>3 days / step</option>
            <option value={7}>7 days / step</option>
            <option value={30}>30 days / step</option>
          </select>
        </label>
      </div>
    </section>
  );
}
