import { Link } from "react-router-dom";
import type { AgentInfo } from "../lib/types";
import { relTime, riskColorRaw } from "../lib/utils";
import GradientAvatar from "./GradientAvatar";

interface Props {
  agent: AgentInfo;
}

export default function AgentRow({ agent }: Props) {
  const isActive = agent.status === "active";

  return (
    <Link
      to={`/agent/${encodeURIComponent(agent.id)}`}
      className="flex items-center gap-3 px-3 py-2 rounded-lg transition-colors"
      style={{
        backgroundColor: "var(--cl-surface)",
        border: "1px solid var(--cl-border)",
      }}
    >
      {/* Avatar */}
      <GradientAvatar agentId={agent.id} size="xs" />

      {/* Name + status */}
      <div className="min-w-0 flex-1 flex items-center gap-2">
        <span
          className="text-sm font-semibold truncate"
          style={{ color: "var(--cl-text-primary)" }}
        >
          {agent.name}
        </span>
        {agent.needsAttention && (
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#fbbf24"
            strokeWidth="2.5"
            strokeLinecap="round"
            className="shrink-0"
          >
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z M12 9v4 M12 17h.01" />
          </svg>
        )}
        {isActive && (
          <span
            className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
            style={{
              backgroundColor: "var(--cl-risk-low)",
              boxShadow: "0 0 4px rgba(74, 222, 128, 0.5)",
              animation: "pulse 2s ease-in-out infinite",
            }}
          />
        )}
        {agent.mode === "scheduled" && (
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--cl-text-muted)"
            strokeWidth="2"
            strokeLinecap="round"
            className="shrink-0"
          >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        )}
      </div>

      {/* Sparkline */}
      <Sparkline data={agent.hourlyActivity} />

      {/* Action count */}
      <span
        className="font-mono text-xs tabular-nums shrink-0"
        style={{ color: "var(--cl-text-secondary)", minWidth: 48, textAlign: "right" }}
      >
        {agent.todayToolCalls} <span style={{ color: "var(--cl-text-muted)" }}>act</span>
      </span>

      {/* Risk badge */}
      <RiskBadge score={agent.avgRiskScore} />

      {/* Relative time */}
      <span
        className="font-mono text-[10px] shrink-0"
        style={{ color: "var(--cl-text-muted)", minWidth: 44, textAlign: "right" }}
      >
        {agent.lastActiveTimestamp ? relTime(agent.lastActiveTimestamp) : "idle"}
      </span>
    </Link>
  );
}

function Sparkline({ data }: { data: number[] }) {
  const max = Math.max(...data, 1);
  const w = 64;
  const h = 18;
  const barW = w / data.length;

  return (
    <svg width={w} height={h} className="shrink-0">
      {data.map((v, i) => {
        if (v === 0) return null;
        const barH = Math.max(1, (v / max) * h);
        return (
          <rect
            key={i}
            x={i * barW}
            y={h - barH}
            width={Math.max(barW - 0.5, 0.5)}
            height={barH}
            rx={0.5}
            fill="var(--cl-accent)"
            opacity={0.6}
          />
        );
      })}
    </svg>
  );
}

function RiskBadge({ score }: { score: number }) {
  const tier = score > 75 ? "critical" : score > 50 ? "high" : score > 25 ? "medium" : "low";
  const color = riskColorRaw(tier);

  return (
    <span
      className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0"
      style={{
        color,
        backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
        minWidth: 28,
        textAlign: "center",
      }}
    >
      {score}
    </span>
  );
}
