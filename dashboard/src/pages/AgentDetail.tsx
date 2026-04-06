import { useParams, Link } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import type { AgentDetailResponse } from "../lib/types";
import { relTime } from "../lib/utils";
import GradientAvatar from "../components/GradientAvatar";
import RiskArc from "../components/RiskArc";
import ActivityBar from "../components/ActivityBar";
import DecisionBadge from "../components/DecisionBadge";

export default function AgentDetail() {
  const { agentId } = useParams<{ agentId: string }>();
  const { data, loading, error } = useApi<AgentDetailResponse>(
    `api/agent/${encodeURIComponent(agentId || "")}`,
  );

  if (loading) {
    return (
      <div className="text-center py-20" style={{ color: "var(--cl-text-muted)" }}>
        Loading...
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="text-center py-20" style={{ color: "var(--cl-text-muted)" }}>
        {error ? `Error: ${error}` : "Agent not found"}
        <br />
        <Link to="/" className="text-sm mt-2 inline-block" style={{ color: "var(--cl-accent)" }}>
          &larr; Back to Agents
        </Link>
      </div>
    );
  }

  const { agent, recentActivity, sessions } = data;

  return (
    <div>
      {/* Back link */}
      <Link
        to="/"
        className="text-sm mb-6 inline-block"
        style={{ color: "var(--cl-text-muted)" }}
      >
        &larr; Back to Agents
      </Link>

      {/* Agent header */}
      <div
        className="rounded-xl border p-6 mb-8"
        style={{
          backgroundColor: "var(--cl-surface)",
          borderColor: "var(--cl-border-default)",
        }}
      >
        <div className="flex items-center gap-4 mb-4">
          <GradientAvatar agentId={agent.id} size="lg" />
          <div>
            <h1
              className="font-display font-bold text-xl"
              style={{ color: "var(--cl-text-primary)" }}
            >
              {agent.name}
            </h1>
            <span className="font-mono text-xs" style={{ color: "var(--cl-text-secondary)" }}>
              {agent.status === "active" ? "Active" : "Idle"}
              {agent.lastActiveTimestamp && ` \u00b7 ${relTime(agent.lastActiveTimestamp)}`}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-8">
          <RiskArc score={agent.avgRiskScore} size={100} />
          {agent.activityBreakdown && (
            <div className="flex-1">
              <ActivityBar breakdown={agent.activityBreakdown} />
            </div>
          )}
        </div>
      </div>

      {/* Recent activity */}
      <h2
        className="label-mono mb-4"
        style={{ color: "var(--cl-text-muted)" }}
      >
        RECENT ACTIVITY
      </h2>
      <div
        className="rounded-xl border divide-y overflow-hidden mb-8"
        style={{
          backgroundColor: "var(--cl-surface)",
          borderColor: "var(--cl-border-subtle)",
        }}
      >
        {recentActivity.length === 0 ? (
          <p className="p-6 text-center" style={{ color: "var(--cl-text-muted)" }}>
            No activity yet
          </p>
        ) : (
          recentActivity.map((entry, i) => (
            <div
              key={entry.toolCallId || i}
              className="flex items-center justify-between px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <span className="text-sm" style={{ color: "var(--cl-text-primary)" }}>
                  {entry.toolName}
                </span>
                <span className="font-mono text-xs ml-2" style={{ color: "var(--cl-text-secondary)" }}>
                  {relTime(entry.timestamp)}
                </span>
              </div>
              {entry.effectiveDecision && entry.effectiveDecision !== "allow" && (
                <DecisionBadge decision={entry.effectiveDecision} />
              )}
              {entry.riskScore != null && (
                <span className="font-mono text-xs ml-3" style={{ color: "var(--cl-text-secondary)" }}>
                  risk: {entry.riskScore}
                </span>
              )}
            </div>
          ))
        )}
      </div>

      {/* Sessions */}
      <h2
        className="label-mono mb-4"
        style={{ color: "var(--cl-text-muted)" }}
      >
        SESSIONS ({sessions.length})
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {sessions.map((s) => (
          <Link
            key={s.sessionKey}
            to={`/session/${encodeURIComponent(s.sessionKey)}`}
            className="rounded-xl border p-4 transition-colors"
            style={{
              backgroundColor: "var(--cl-surface)",
              borderColor: "var(--cl-border-subtle)",
            }}
          >
            <div className="font-mono text-xs mb-1" style={{ color: "var(--cl-text-secondary)" }}>
              {new Date(s.startTime).toLocaleString()}
            </div>
            <div className="text-sm" style={{ color: "var(--cl-text-primary)" }}>
              {s.toolCallCount} actions
            </div>
            <div className="font-mono text-xs" style={{ color: "var(--cl-text-muted)" }}>
              avg risk: {s.avgRisk}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
