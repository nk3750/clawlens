import { useState } from "react";
import { splitAgentsRunning } from "./utils";

interface Props {
  /** stats.activeAgents — agents with activity in the last threshold window. */
  active: number;
  /** stats.activeSessions — open sessions still emitting events. */
  activeSessions: number;
  /** Total agents known on the day, for the "of N" denominator. */
  total: number;
}

/**
 * "● 4 of 6 agents running" — replaces the confusing active/idle tile.
 * Click scrolls to the agents grid; tooltip on hover splits into a brief
 * breakdown of running-now vs. between-sessions counts.
 */
export default function AgentsRunning({ active, activeSessions, total }: Props) {
  const [hovered, setHovered] = useState(false);
  const { runningNow, betweenSessions } = splitAgentsRunning(active, activeSessions);
  const dotColor = active > 0 ? "var(--cl-risk-low)" : "var(--cl-text-muted)";

  function onClick() {
    const target =
      document.querySelector<HTMLElement>("[data-cl-agents-anchor]") ??
      document.getElementById("agents");
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      title={`${active} of ${total} active — last 15 min`}
      aria-label={`${active} of ${total} agents active in the last 15 minutes`}
      className="cl-fh-chip btn-press inline-flex items-center"
      style={{
        gap: 6,
        padding: "4px 10px",
        borderRadius: "var(--cl-radius-sm, 6px)",
        border: "1px solid var(--cl-border-subtle)",
        background: "transparent",
        cursor: "pointer",
        position: "relative",
        color: "var(--cl-text-primary)",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: dotColor,
          boxShadow: active > 0 ? `0 0 6px ${dotColor}` : undefined,
          animation: active > 0 ? "pulse 2s ease-in-out infinite" : undefined,
        }}
      />
      <span
        className="font-mono"
        style={{ fontSize: 12, fontWeight: 600, color: "var(--cl-text-primary)" }}
      >
        {active}
        <span style={{ color: "var(--cl-text-secondary)", fontWeight: 500 }}> of {total}</span>
      </span>
      <span className="font-sans" style={{ fontSize: 11, color: "var(--cl-text-secondary)" }}>
        agents running
      </span>

      {hovered && (
        <span
          role="tooltip"
          className="cl-fh-tooltip"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            zIndex: 20,
            background: "var(--cl-elevated)",
            border: "1px solid var(--cl-border-subtle)",
            borderRadius: "var(--cl-radius-sm, 6px)",
            padding: "8px 10px",
            fontSize: 11,
            color: "var(--cl-text-secondary)",
            minWidth: 200,
            boxShadow: "0 4px 12px rgba(0,0,0,0.35)",
            whiteSpace: "nowrap",
            textAlign: "left",
          }}
        >
          <div style={{ marginBottom: 4, color: "var(--cl-text-primary)", fontWeight: 600 }}>
            {active} active — last 15 min
          </div>
          <div>
            <span style={{ color: "var(--cl-risk-low)" }}>● {runningNow}</span> running a session
          </div>
          <div>
            <span style={{ color: "var(--cl-text-muted)" }}>● {betweenSessions}</span> between
            sessions
          </div>
        </span>
      )}
    </button>
  );
}
