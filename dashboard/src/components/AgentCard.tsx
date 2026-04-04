import { Link } from "react-router-dom";
import type { AgentInfo } from "../lib/types";
import { relTime, riskTierFromScore } from "../lib/utils";
import RiskBadge from "./RiskBadge";

export default function AgentCard({
  agent,
  index,
}: {
  agent: AgentInfo;
  index: number;
}) {
  const riskTier = agent.peakRiskScore
    ? riskTierFromScore(agent.peakRiskScore)
    : undefined;

  return (
    <Link
      to={`/agent/${encodeURIComponent(agent.id)}`}
      className="block bg-card border border-border rounded-xl p-5 hover:border-border-hover transition-all duration-200 hover:bg-elevated/50 animate-fade-in group"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div
            className={`w-2 h-2 rounded-full shrink-0 ${
              agent.status === "active"
                ? "bg-status-active animate-status-pulse"
                : "bg-status-idle"
            }`}
          />
          <h3 className="font-display font-semibold text-primary text-[15px] group-hover:text-accent transition-colors truncate">
            {agent.name}
          </h3>
        </div>
        <RiskBadge
          score={agent.peakRiskScore || undefined}
          tier={riskTier}
        />
      </div>

      {agent.currentSession && (
        <div className="mb-3 px-3 py-2 bg-surface rounded-lg border border-border/50 text-xs">
          <div className="flex items-center gap-2 text-muted">
            <span className="text-status-active text-[8px]">
              {"\u25cf"}
            </span>
            <span className="font-mono text-secondary truncate">
              {agent.currentSession.sessionKey}
            </span>
          </div>
          <div className="mt-1 text-muted">
            {agent.currentSession.toolCallCount} calls in session
          </div>
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-muted">
        <span>
          <span className="text-secondary font-mono">
            {agent.todayToolCalls}
          </span>{" "}
          calls today
        </span>
        <span>
          {agent.lastActiveTimestamp
            ? relTime(agent.lastActiveTimestamp)
            : "Never"}
        </span>
      </div>
    </Link>
  );
}
