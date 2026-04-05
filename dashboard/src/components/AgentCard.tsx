import { Link } from "react-router-dom";
import type { AgentInfo, EntryResponse } from "../lib/types";
import {
  relTime,
  agentColor,
  describeAction,
  decisionLabel,
  riskTierFromScore,
} from "../lib/utils";
import AgentAvatar from "./AgentAvatar";
import RiskBadge from "./RiskBadge";

/**
 * Agent Station — the hero card on the Overview page.
 * Shows what an agent is doing, not just stats about it.
 */
export default function AgentCard({
  agent,
  recentActions,
}: {
  agent: AgentInfo;
  recentActions?: EntryResponse[];
  index?: number;
}) {
  const color = agentColor(agent.id);
  const isActive = agent.status === "active";
  const riskTier = agent.peakRiskScore
    ? riskTierFromScore(agent.peakRiskScore)
    : undefined;

  return (
    <Link
      to={`/agent/${encodeURIComponent(agent.id)}`}
      className={`block bg-card border rounded-2xl p-5 transition-all duration-300 group hover:translate-y-[-2px] ${
        isActive
          ? "border-border-hover agent-glow hover:shadow-lg"
          : "border-border hover:border-border-hover"
      }`}
      style={{ "--agent-color": color } as React.CSSProperties}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <AgentAvatar agentId={agent.id} size="lg" showPulse={isActive} />
          <div>
            <h3 className="font-display font-bold text-primary text-base group-hover:text-accent transition-colors">
              {agent.name}
            </h3>
            <p className="text-xs text-muted mt-0.5">
              {isActive ? (
                <>
                  <span className="text-status-active">Active</span>
                  {agent.currentSession && (
                    <span> {"\u00b7"} {agent.currentSession.toolCallCount} actions in session</span>
                  )}
                </>
              ) : (
                <>
                  Idle {"\u00b7"}{" "}
                  {agent.lastActiveTimestamp
                    ? `last seen ${relTime(agent.lastActiveTimestamp)}`
                    : "no activity yet"}
                </>
              )}
            </p>
          </div>
        </div>
        <div className="text-right">
          <RiskBadge score={agent.peakRiskScore || undefined} tier={riskTier} />
          <div className="text-[10px] text-muted mt-1">peak risk</div>
        </div>
      </div>

      {/* Recent actions mini-feed */}
      {recentActions && recentActions.length > 0 && (
        <div className="mt-3 space-y-1 bg-surface/50 rounded-xl p-3 border border-border/30">
          {recentActions.slice(0, 4).map((action, i) => {
            const tier = action.riskTier || (action.riskScore != null ? riskTierFromScore(action.riskScore) : undefined);
            return (
              <div key={action.toolCallId || i} className="flex items-center gap-2 text-xs py-0.5">
                <RiskBadge score={action.riskScore} tier={tier} compact />
                <span className="text-secondary truncate flex-1">
                  {describeAction(action)}
                </span>
                <span className={`shrink-0 text-[10px] ${
                  action.effectiveDecision === "block" || action.effectiveDecision === "denied"
                    ? "text-risk-high"
                    : action.effectiveDecision === "pending"
                      ? "text-risk-medium"
                      : "text-muted"
                }`}>
                  {decisionLabel(action.effectiveDecision)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer stats */}
      <div className="mt-3 flex items-center gap-4 text-xs text-muted pt-2 border-t border-border/30">
        <span>
          <span className="text-secondary font-mono">{agent.todayToolCalls}</span> actions today
        </span>
        {agent.avgRiskScore > 0 && (
          <span>
            avg risk{" "}
            <span className="text-secondary font-mono">{agent.avgRiskScore}</span>
          </span>
        )}
        <span className="ml-auto text-[11px] text-muted/60 group-hover:text-accent/60 transition-colors">
          View details {"\u2192"}
        </span>
      </div>
    </Link>
  );
}
