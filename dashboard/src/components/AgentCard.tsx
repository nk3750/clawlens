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
      className="cl-card block cursor-pointer"
      style={{ padding: "clamp(24px, 3vw, 36px)" }}
    >
      {/* Radial tier glow (visible on hover via CSS) */}
      <div
        className="absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-700 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse 70% 50% at 50% 0%, ${tierColor}06 0%, transparent 70%)`,
        }}
      />

      {/* Attention indicator */}
      {agent.needsAttention && (
        <div className="absolute -top-2 -right-2 z-10" title={agent.attentionReason}>
          <div
            className="w-5 h-5 rounded-full flex items-center justify-center"
            style={{
              backgroundColor: "rgba(251, 191, 36, 0.15)",
              border: "1px solid rgba(251, 191, 36, 0.3)",
            }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2.5">
              <path d="M12 9v4M12 17h.01" strokeLinecap="round" />
            </svg>
          </div>
        </div>
      )}

      {/* ── Top: Avatar + Identity ── */}
      <div className="flex items-start gap-4 mb-6">
        <GradientAvatar agentId={agent.id} size="md" />
        <div className="min-w-0 flex-1 pt-0.5">
          <h3
            className="font-display font-bold truncate"
            style={{
              color: "var(--cl-text-primary)",
              fontSize: "clamp(15px, 1.2vw, 18px)",
            }}
          >
            {agent.name}
          </h3>
          <StatusLine agent={agent} />
        </div>
      </div>

      {/* ── Context (if present) ── */}
      {agent.currentContext && (
        <p
          className="text-[13px] italic mb-6 leading-relaxed"
          style={{ color: "var(--cl-text-muted)" }}
        >
          &ldquo;{agent.currentContext}&rdquo;
        </p>
      )}

      {/* ── Risk Arc — the hero visual ── */}
      <div className="mb-6">
        <RiskArc score={agent.avgRiskScore} size={90} />
      </div>

      {/* ── Activity fingerprint ── */}
      <div className="mb-6">
        <ActivityBar breakdown={agent.activityBreakdown} />
      </div>

      {/* ── Footer — separated by gradient divider ── */}
      <div className="cl-divider mb-4" />
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          {agent.latestAction && (
            <p
              className="text-[13px] truncate leading-snug"
              style={{ color: "var(--cl-text-primary)" }}
            >
              {agent.latestAction}
            </p>
          )}
          {agent.latestActionTime && (
            <span className="font-mono text-[11px]" style={{ color: "var(--cl-text-secondary)" }}>
              {relTime(agent.latestActionTime)}
            </span>
          )}
        </div>
        <span className="label-mono shrink-0" style={{ color: "var(--cl-text-muted)" }}>
          {agent.todayToolCalls} actions
        </span>
      </div>
    </Link>
  );
}

function StatusLine({ agent }: { agent: AgentInfo }) {
  if (agent.mode === "scheduled") {
    return (
      <span className="flex items-center gap-1.5 mt-1">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        <span className="font-mono text-[11px]" style={{ color: "#a78bfa" }}>
          {agent.schedule ?? "scheduled"}
        </span>
      </span>
    );
  }

  if (agent.status === "active") {
    return (
      <span className="flex items-center gap-1.5 mt-1">
        <span
          className="inline-block w-[5px] h-[5px] rounded-full"
          style={{
            backgroundColor: "var(--cl-risk-low)",
            boxShadow: "0 0 6px rgba(74, 222, 128, 0.5)",
            animation: "pulse 2s ease-in-out infinite",
          }}
        />
        <span className="font-mono text-[11px]" style={{ color: "var(--cl-risk-low)" }}>Active</span>
      </span>
    );
  }

  return (
    <span className="font-mono text-[11px] mt-1 inline-block" style={{ color: "var(--cl-text-muted)" }}>
      {agent.lastActiveTimestamp ? relTime(agent.lastActiveTimestamp) : "idle"}
    </span>
  );
}
