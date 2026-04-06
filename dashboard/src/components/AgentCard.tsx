import { Link } from "react-router-dom";
import type { AgentInfo } from "../lib/types";
import { relTime, riskTierFromScore, riskColorRaw } from "../lib/utils";
import GradientAvatar from "./GradientAvatar";
import RiskArc from "./RiskArc";
import ActivityBar from "./ActivityBar";

interface Props {
  agent: AgentInfo;
}

export default function AgentCard({ agent }: Props) {
  const tierColor = riskColorRaw(riskTierFromScore(agent.avgRiskScore));

  return (
    <Link
      to={`/agent/${encodeURIComponent(agent.id)}`}
      className="cl-card block relative cursor-pointer p-7"
    >
      {/* Hover glow overlay — appears on hover */}
      <div
        className="absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-500 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse at 50% 0%, ${tierColor}08 0%, transparent 70%)`,
        }}
      />

      {/* Attention indicator */}
      {agent.needsAttention && (
        <div
          className="absolute -top-1 -right-1 z-10"
          title={agent.attentionReason}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>
      )}

      {/* Header: avatar + name + status */}
      <div className="flex items-center gap-4 mb-4">
        <GradientAvatar agentId={agent.id} size="md" />
        <div className="min-w-0 flex-1">
          <h3
            className="font-display font-bold text-[15px] truncate"
            style={{ color: "var(--cl-text-primary)" }}
          >
            {agent.name}
          </h3>
          <StatusIndicator agent={agent} />
        </div>
      </div>

      {/* Context line */}
      {agent.currentContext && (
        <p
          className="text-[13px] italic mb-5 truncate"
          style={{ color: "var(--cl-text-secondary)" }}
        >
          &ldquo;{agent.currentContext}&rdquo;
        </p>
      )}

      {/* Risk Arc — with tier-colored glow on card hover */}
      <div className="mb-5">
        <RiskArc score={agent.avgRiskScore} />
      </div>

      {/* Activity bar */}
      <div className="mb-5">
        <ActivityBar breakdown={agent.activityBreakdown} />
      </div>

      {/* Footer: latest action + count */}
      <div
        className="flex items-center justify-between gap-2 pt-4"
        style={{ borderTop: "1px solid var(--cl-border-subtle)" }}
      >
        <div className="min-w-0 flex-1">
          {agent.latestAction && (
            <p
              className="text-[13px] truncate"
              style={{ color: "var(--cl-text-primary)" }}
            >
              {agent.latestAction}
            </p>
          )}
          {agent.latestActionTime && (
            <span
              className="font-mono text-xs"
              style={{ color: "var(--cl-text-secondary)" }}
            >
              {relTime(agent.latestActionTime)}
            </span>
          )}
        </div>
        <span
          className="label-mono shrink-0"
          style={{ color: "var(--cl-text-muted)" }}
        >
          {agent.todayToolCalls} actions
        </span>
      </div>
    </Link>
  );
}

function StatusIndicator({ agent }: { agent: AgentInfo }) {
  if (agent.mode === "scheduled") {
    return (
      <span className="flex items-center gap-1.5">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--cl-cat-commands)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M23 4v6h-6M1 20v-6h6" />
          <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
        </svg>
        <span style={{ color: "var(--cl-cat-commands)" }} className="font-mono text-[11px]">
          {agent.schedule ?? "scheduled"}
        </span>
      </span>
    );
  }

  if (agent.status === "active") {
    return (
      <span className="flex items-center gap-1.5">
        <span
          className="inline-block w-[6px] h-[6px] rounded-full"
          style={{
            backgroundColor: "var(--cl-risk-low)",
            boxShadow: "0 0 6px rgba(74, 222, 128, 0.5)",
            animation: "pulse 2s ease-in-out infinite",
          }}
        />
        <span style={{ color: "var(--cl-risk-low)" }} className="font-mono text-[11px]">
          Active
        </span>
        <style>{`@keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:.5 } }`}</style>
      </span>
    );
  }

  return (
    <span className="font-mono text-[11px]" style={{ color: "var(--cl-text-muted)" }}>
      {agent.lastActiveTimestamp ? relTime(agent.lastActiveTimestamp) : "idle"}
    </span>
  );
}
