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
    <section className="relative py-10">
      {/* Atmospheric halo behind posture label */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[200px] rounded-full pointer-events-none"
        style={{
          background: `radial-gradient(ellipse, ${color}08 0%, transparent 70%)`,
          filter: "blur(40px)",
        }}
      />

      {/* Content */}
      <div className="relative flex flex-col items-center text-center gap-6">
        {/* Fleet posture — the hero element */}
        <div className="flex flex-col items-center gap-2">
          <span className="label-mono" style={{ color: "var(--cl-text-muted)" }}>
            Fleet risk posture
          </span>
          <h1
            className="font-display font-bold tracking-tight"
            style={{
              fontSize: "var(--text-hero)",
              color,
              textShadow: `0 0 40px ${color}20, 0 0 80px ${color}08`,
              lineHeight: 1.1,
            }}
          >
            {postureLabel(stats.riskPosture)}
          </h1>
        </div>

        {/* Risk gradient bar — wide, cinematic */}
        <div className="flex items-center gap-4">
          <div
            className="h-[3px] rounded-full overflow-hidden"
            style={{ width: 200, backgroundColor: "var(--cl-elevated)" }}
          >
            <div
              className="h-full rounded-full transition-all duration-1000"
              style={{
                width: `${Math.min(100, stats.avgRiskScore)}%`,
                background: `linear-gradient(90deg, ${color}90, ${color})`,
                boxShadow: `0 0 12px ${color}50`,
              }}
            />
          </div>
          <span className="font-mono text-[12px]" style={{ color: "var(--cl-text-secondary)" }}>
            avg {stats.avgRiskScore} &middot; peak {stats.peakRiskScore}
          </span>
        </div>

        {/* Stats row — spaced out, not cramped */}
        <div className="flex items-center gap-8 mt-2">
          <Stat value={stats.activeAgents} label="agents active" dot={color} />
          <Stat value={stats.total} label="actions today" />
          <div className="flex items-center gap-4">
            <TierPip color="#4ade80" count={rb.low} />
            <TierPip color="#fbbf24" count={rb.medium} />
            <TierPip color="#f87171" count={rb.high} />
            <TierPip color="#ef4444" count={rb.critical} />
          </div>
        </div>
      </div>

      {/* Bottom gradient divider */}
      <div className="cl-divider mt-10" />
    </section>
  );
}

function Stat({ value, label, dot }: { value: number; label: string; dot?: string }) {
  return (
    <div className="flex items-center gap-2">
      {dot && (
        <span
          className="inline-block w-[6px] h-[6px] rounded-full"
          style={{ backgroundColor: dot, boxShadow: `0 0 8px ${dot}60` }}
        />
      )}
      <span className="font-mono text-[13px] font-medium" style={{ color: "var(--cl-text-primary)" }}>
        {value}
      </span>
      <span className="text-[12px]" style={{ color: "var(--cl-text-muted)" }}>
        {label}
      </span>
    </div>
  );
}

function TierPip({ color, count }: { color: string; count: number }) {
  return (
    <div className="flex items-center gap-1" title={`${count} entries`}>
      <span
        className="inline-block w-[5px] h-[5px] rounded-full"
        style={{
          backgroundColor: color,
          boxShadow: count > 0 ? `0 0 4px ${color}50` : "none",
          opacity: count > 0 ? 1 : 0.3,
        }}
      />
      <span className="font-mono text-[10px]" style={{ color: "var(--cl-text-muted)" }}>
        {count}
      </span>
    </div>
  );
}
