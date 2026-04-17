import { useState } from "react";
import { computeTrend } from "./utils";

interface Props {
  total: number;
  yesterdayTotal: number;
  weekAverage: number;
  historicDailyMax: number;
}

/**
 * "⚡ 192 actions  ↑ 98% vs yesterday" — center cluster of the fleet header.
 *
 * Trend rendering matches spec §10's four-state contract: empty → no label,
 * new → "first day tracking" without a percent, same → em-dash, up/down with
 * a rounded percent. The numeric flash on >2% deltas is handled in the parent
 * since the parent owns the StatsResponse identity across SSE updates.
 */
export default function ActionsStat({
  total,
  yesterdayTotal,
  weekAverage,
  historicDailyMax,
}: Props) {
  const [tipOpen, setTipOpen] = useState(false);
  const trend = computeTrend(total, yesterdayTotal);

  let trendNode: React.ReactNode = null;
  if (trend.kind === "up") {
    trendNode = (
      <span style={{ color: "var(--cl-accent)", fontWeight: 600 }}>{trend.label}</span>
    );
  } else if (trend.kind === "down") {
    trendNode = (
      <span style={{ color: "var(--cl-risk-medium)", fontWeight: 600 }}>{trend.label}</span>
    );
  } else if (trend.kind === "same") {
    trendNode = <span style={{ color: "var(--cl-text-muted)" }}>{trend.label}</span>;
  } else if (trend.kind === "new") {
    trendNode = <span style={{ color: "var(--cl-text-muted)" }}>{trend.label}</span>;
  }

  return (
    <div
      className="cl-fh-actions inline-flex items-baseline"
      style={{ gap: 10, position: "relative" }}
      onMouseEnter={() => setTipOpen(true)}
      onMouseLeave={() => setTipOpen(false)}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--cl-accent)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        style={{ alignSelf: "center" }}
      >
        <path d="M13 2L3 14h9l-1 10 10-12h-9l1-10z" />
      </svg>
      <span
        className="font-mono"
        style={{
          fontSize: 20,
          fontWeight: 700,
          color: "var(--cl-text-primary)",
          letterSpacing: "-0.01em",
        }}
      >
        {total.toLocaleString()}
      </span>
      <span
        className="font-sans"
        style={{ fontSize: 12, color: "var(--cl-text-secondary)" }}
      >
        actions
      </span>
      {trendNode && (
        <span className="font-sans" style={{ fontSize: 11.5 }}>
          {trendNode}
        </span>
      )}

      {tipOpen && (
        <span
          role="tooltip"
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
            fontFamily: "ui-monospace, monospace",
          }}
        >
          <div>today {total.toLocaleString()}</div>
          <div>yesterday {yesterdayTotal.toLocaleString()}</div>
          <div>7d avg {weekAverage.toLocaleString()}</div>
          <div>peak day {historicDailyMax.toLocaleString()}</div>
        </span>
      )}
    </div>
  );
}
