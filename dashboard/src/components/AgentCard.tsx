import { Link } from "react-router-dom";
import type { AgentInfo } from "../lib/types";
import { relTime, agentColor, parseSessionContext } from "../lib/utils";
import AgentAvatar from "./AgentAvatar";

/**
 * Agent card — name, status, trigger context. No risk numbers on surface.
 * Risk only shows as a subtle text label when it's elevated.
 */
export default function AgentCard({ agent }: { agent: AgentInfo; index?: number }) {
  const isActive = agent.status === "active";
  const color = agentColor(agent.id);

  // Parse trigger context from session key
  const sessionContext = agent.currentSession
    ? parseSessionContext(agent.currentSession.sessionKey)
    : null;

  // Only surface risk when it's noteworthy (medium+)
  const riskLabel =
    agent.avgRiskScore > 60 ? "high risk" :
    agent.avgRiskScore > 30 ? "moderate risk" :
    null;

  const riskColor =
    agent.avgRiskScore > 60 ? "text-risk-high" :
    agent.avgRiskScore > 30 ? "text-risk-medium" :
    "";

  return (
    <Link
      to={`/agent/${encodeURIComponent(agent.id)}`}
      className={`flex items-center gap-4 px-4 py-4 rounded-2xl border transition-all duration-300 group hover:translate-y-[-1px] ${
        isActive
          ? "bg-card border-border-hover agent-glow"
          : "bg-card/60 border-border/60 hover:border-border-hover hover:bg-card"
      }`}
      style={{ "--agent-color": color } as React.CSSProperties}
    >
      <AgentAvatar agentId={agent.id} size="md" showPulse={isActive} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-display font-semibold text-primary text-[14px] group-hover:text-accent transition-colors">
            {agent.name}
          </span>
          {isActive ? (
            <span className="text-[11px] text-status-active font-medium">Active</span>
          ) : (
            <span className="text-[11px] text-muted">
              {agent.lastActiveTimestamp ? relTime(agent.lastActiveTimestamp) : "no activity"}
            </span>
          )}
        </div>
        <div className="text-[11px] text-muted mt-0.5 flex items-center gap-2">
          {/* Trigger/channel context */}
          {isActive && sessionContext && (
            <>
              <span className="text-secondary/70">{sessionContext.label}</span>
              <span className="text-border">{"\u00b7"}</span>
            </>
          )}
          {!isActive && agent.todayToolCalls === 0 && sessionContext === null && (
            // Try to infer if this is a cron agent from the name
            agent.name.includes("bot") || agent.name.includes("pipeline") ? (
              <span className="text-muted/60">Scheduled agent</span>
            ) : null
          )}
          <span>
            {agent.todayToolCalls > 0
              ? `${agent.todayToolCalls} action${agent.todayToolCalls !== 1 ? "s" : ""} today`
              : "No actions today"}
          </span>
        </div>
      </div>

      {/* Risk — only show when noteworthy */}
      {riskLabel && (
        <span className={`text-[11px] ${riskColor} shrink-0`}>
          {riskLabel}
        </span>
      )}
    </Link>
  );
}
