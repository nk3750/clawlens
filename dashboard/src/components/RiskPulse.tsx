import type { StatsResponse } from "../lib/types";
import { postureLabel } from "../lib/utils";

interface Props {
  stats: StatsResponse;
}

const POSTURE_COLOR: Record<string, string> = {
  calm: "#4ade80",
  elevated: "#fbbf24",
  high: "#f87171",
  critical: "#ef4444",
};

export default function RiskPulse({ stats }: Props) {
  const rb = stats.riskBreakdown;
  const color = POSTURE_COLOR[stats.riskPosture] ?? POSTURE_COLOR.calm;

  return (
    <div
      className="cl-card p-6"
      style={{
        background: `linear-gradient(135deg, var(--cl-surface) 0%, rgba(13,15,21,0.8) 100%)`,
      }}
    >
      {/* Posture glow accent line at top */}
      <div
        className="absolute top-0 left-8 right-8 h-px"
        style={{
          background: `linear-gradient(90deg, transparent, ${color}40, transparent)`,
        }}
      />

      <div className="flex flex-wrap items-center justify-between gap-6">
        {/* Left: agent count + action count */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{
                backgroundColor: color,
                boxShadow: `0 0 8px ${color}60`,
              }}
            />
            <span style={{ color: "var(--cl-text-primary)" }} className="font-body font-medium text-[14px]">
              {stats.activeAgents} agent{stats.activeAgents !== 1 ? "s" : ""} active
            </span>
          </div>
          <span className="font-mono text-[11px]" style={{ color: "var(--cl-text-muted)" }}>
            {stats.total} actions today
          </span>
        </div>

        {/* Center: fleet risk posture */}
        <div className="flex flex-col items-center gap-1.5">
          <span className="label-mono" style={{ color: "var(--cl-text-muted)" }}>
            Risk across fleet
          </span>
          <span
            className="font-display text-xl font-bold"
            style={{
              color,
              textShadow: `0 0 20px ${color}30`,
            }}
          >
            {postureLabel(stats.riskPosture)}
          </span>
          {/* Risk gradient bar */}
          <div className="flex items-center gap-3 mt-1">
            <div
              className="h-1.5 rounded-full overflow-hidden"
              style={{
                width: 120,
                backgroundColor: "var(--cl-elevated)",
              }}
            >
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${Math.min(100, stats.avgRiskScore)}%`,
                  background: `linear-gradient(90deg, ${color}, ${color}90)`,
                  boxShadow: `0 0 8px ${color}40`,
                }}
              />
            </div>
            <span className="font-mono text-[11px]" style={{ color: "var(--cl-text-secondary)" }}>
              avg {stats.avgRiskScore} &middot; peak {stats.peakRiskScore}
            </span>
          </div>
        </div>

        {/* Right: tier distribution */}
        <div className="flex items-center gap-4">
          <TierDot color="#4ade80" count={rb.low} label="low" />
          <TierDot color="#fbbf24" count={rb.medium} label="med" />
          <TierDot color="#f87171" count={rb.high} label="high" />
          <TierDot color="#ef4444" count={rb.critical} label="crit" />
          <span className="label-mono" style={{ color: "var(--cl-text-muted)" }}>
            last 24h
          </span>
        </div>
      </div>
    </div>
  );
}

function TierDot({ color, count, label }: { color: string; count: number; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <span
        className="inline-block w-[6px] h-[6px] rounded-full"
        style={{
          backgroundColor: color,
          boxShadow: count > 0 ? `0 0 4px ${color}50` : "none",
        }}
      />
      <span className="font-mono text-[11px]" style={{ color: "var(--cl-text-secondary)" }}>
        {count} {label}
      </span>
    </div>
  );
}
