import { Link } from "react-router-dom";
import type { AgentInfo, RiskTier } from "../lib/types";
import { relTime, riskTierFromScore, riskColorRaw } from "../lib/utils";
import GradientAvatar from "./GradientAvatar";

interface Props {
  agent: AgentInfo;
  guardrailCount: number;
}

export default function AgentCardCompact({ agent, guardrailCount }: Props) {
  const tier = riskTierFromScore(agent.avgRiskScore);
  const tierColor = riskColorRaw(tier);

  return (
    <Link
      to={`/agent/${encodeURIComponent(agent.id)}`}
      className="block rounded-xl px-4 py-3 transition-all"
      style={{
        backgroundColor: "var(--cl-surface)",
        border: "1px solid var(--cl-border)",
        boxShadow: agent.status === "active" ? `inset 3px 0 0 0 ${riskColorRaw("low")}` : undefined,
      }}
    >
      <div className="flex items-center gap-3">
        {/* Avatar */}
        <GradientAvatar agentId={agent.id} size="sm" />

        {/* Name + status */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
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
              >
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z M12 9v4 M12 17h.01" />
              </svg>
            )}
          </div>
          <StatusLine agent={agent} />
        </div>

        {/* Risk profile mini bar */}
        <MiniRiskBar profile={agent.riskProfile} />

        {/* Risk score */}
        <div className="text-right shrink-0">
          <span className="font-mono text-sm font-bold" style={{ color: tierColor }}>
            {agent.avgRiskScore}
          </span>
          <span
            className="block font-mono text-[10px] uppercase"
            style={{ color: tierColor, opacity: 0.8 }}
          >
            {tier === "critical" ? "CRIT" : tier === "medium" ? "MED" : tier.toUpperCase()}
          </span>
        </div>

        {/* Guardrail shield */}
        {guardrailCount > 0 && (
          <span
            className="flex items-center gap-0.5 shrink-0 font-mono text-[10px]"
            style={{ color: "var(--cl-text-muted)" }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            {guardrailCount}
          </span>
        )}
      </div>

      {/* Footer: action count + latest action */}
      <div className="flex items-center justify-between mt-2 ml-11">
        <span className="font-mono text-[11px]" style={{ color: "var(--cl-text-muted)" }}>
          {agent.todayToolCalls} actions
        </span>
        {agent.latestAction && (
          <span
            className="text-[11px] truncate ml-3 max-w-[180px]"
            style={{ color: "var(--cl-text-secondary)" }}
          >
            {agent.latestAction}
            {agent.latestActionTime && (
              <span className="font-mono ml-1" style={{ color: "var(--cl-text-muted)" }}>
                {relTime(agent.latestActionTime)}
              </span>
            )}
          </span>
        )}
      </div>
    </Link>
  );
}

function MiniRiskBar({ profile }: { profile: Record<RiskTier, number> }) {
  const total = profile.low + profile.medium + profile.high + profile.critical;
  if (total === 0) return null;

  const tiers: { key: RiskTier; count: number }[] = [
    { key: "low", count: profile.low },
    { key: "medium", count: profile.medium },
    { key: "high", count: profile.high },
    { key: "critical", count: profile.critical },
  ];

  return (
    <svg width="60" height="16" className="shrink-0">
      {tiers.reduce<{ elements: React.ReactElement[]; x: number }>(
        (acc, t) => {
          if (t.count === 0) return acc;
          const w = (t.count / total) * 60;
          acc.elements.push(
            <rect
              key={t.key}
              x={acc.x}
              y={4}
              width={w}
              height={8}
              rx={t.key === "low" ? 2 : 0}
              fill={riskColorRaw(t.key)}
              opacity={0.8}
            />,
          );
          acc.x += w;
          return acc;
        },
        { elements: [], x: 0 },
      ).elements}
    </svg>
  );
}

function StatusLine({ agent }: { agent: AgentInfo }) {
  if (agent.mode === "scheduled") {
    return (
      <span className="flex items-center gap-1 mt-0.5">
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#a78bfa"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        <span className="font-mono text-[10px]" style={{ color: "#a78bfa" }}>
          {agent.schedule ?? "scheduled"}
        </span>
      </span>
    );
  }

  if (agent.status === "active") {
    return (
      <span className="flex items-center gap-1 mt-0.5">
        <span
          className="inline-block w-1 h-1 rounded-full"
          style={{
            backgroundColor: "var(--cl-risk-low)",
            boxShadow: "0 0 4px rgba(74, 222, 128, 0.5)",
            animation: "pulse 2s ease-in-out infinite",
          }}
        />
        <span className="font-mono text-[10px]" style={{ color: "var(--cl-risk-low)" }}>
          Active
        </span>
      </span>
    );
  }

  return (
    <span className="font-mono text-[10px] mt-0.5 inline-block" style={{ color: "var(--cl-text-muted)" }}>
      {agent.lastActiveTimestamp ? relTime(agent.lastActiveTimestamp) : "idle"}
    </span>
  );
}
