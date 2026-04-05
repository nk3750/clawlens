import { useParams, Link } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import type { AgentDetailResponse } from "../lib/types";
import {
  relTime,
  agentColor,
  riskTierFromScore,
} from "../lib/utils";
import AgentAvatar from "../components/AgentAvatar";
import RiskBadge from "../components/RiskBadge";
import EntryRow from "../components/EntryRow";
import SessionCard from "../components/SessionCard";

export default function AgentDetail() {
  const { agentId } = useParams<{ agentId: string }>();
  const { data, loading, error } = useApi<AgentDetailResponse>(
    `api/agent/${encodeURIComponent(agentId || "")}`,
  );

  if (loading) {
    return (
      <div className="text-center py-20 text-muted">
        <div className="inline-block w-6 h-6 border-2 border-border border-t-accent rounded-full animate-spin mb-4" />
        <p className="text-sm font-display">Loading agent\u2026</p>
      </div>
    );
  }
  if (error) return <div className="text-center py-20 text-risk-high">Error: {error}</div>;
  if (!data) return <div className="text-center py-20 text-muted">Agent not found</div>;

  const { agent, recentActivity, sessions, totalSessions } = data;
  const color = agentColor(agent.id);
  const isActive = agent.status === "active";
  const riskTier = agent.peakRiskScore ? riskTierFromScore(agent.peakRiskScore) : undefined;

  // Compute a simple activity summary
  const reads = recentActivity.filter((e) => e.toolName === "read").length;
  const writes = recentActivity.filter((e) => e.toolName === "write").length;
  const execs = recentActivity.filter((e) => e.toolName === "exec").length;
  const messages = recentActivity.filter((e) => e.toolName === "message").length;
  const other = recentActivity.length - reads - writes - execs - messages;

  return (
    <div className="max-w-5xl mx-auto">
      {/* Breadcrumb */}
      <div className="text-xs text-muted mb-5 flex items-center gap-1.5">
        <Link to="/" className="hover:text-secondary transition-colors">ClawLens</Link>
        <span className="text-muted/40">{"\u203a"}</span>
        <span className="text-secondary">{agent.name}</span>
      </div>

      {/* Agent hero */}
      <div
        className="bg-card border border-border rounded-2xl p-6 mb-6 animate-fade-in"
        style={{ borderColor: isActive ? `${color}30` : undefined }}
      >
        <div className="flex items-start gap-4">
          <AgentAvatar agentId={agent.id} size="lg" showPulse={isActive} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="font-display font-bold text-primary text-xl">{agent.name}</h1>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                isActive
                  ? "bg-status-active/10 text-status-active"
                  : "bg-muted/10 text-muted"
              }`}>
                {isActive ? "Active" : "Idle"}
              </span>
              <RiskBadge score={agent.peakRiskScore || undefined} tier={riskTier} />
            </div>

            {/* Status line */}
            <p className="text-sm text-muted mt-1">
              {isActive && agent.currentSession ? (
                <>
                  Running session{" "}
                  <Link
                    to={`/session/${encodeURIComponent(agent.currentSession.sessionKey)}`}
                    className="text-accent hover:underline font-mono text-[11px]"
                  >
                    {agent.currentSession.sessionKey}
                  </Link>
                  {" "}{"\u00b7"} started {relTime(agent.currentSession.startTime)}
                </>
              ) : (
                <>Last active {agent.lastActiveTimestamp ? relTime(agent.lastActiveTimestamp) : "never"}</>
              )}
            </p>

            {/* Activity summary */}
            {recentActivity.length > 0 && (
              <div className="mt-3 flex items-center gap-3 text-xs text-muted flex-wrap">
                <span>
                  <span className="text-secondary font-mono">{agent.todayToolCalls}</span> actions today
                </span>
                <span className="text-border">|</span>
                {reads > 0 && <span>{reads} reads</span>}
                {writes > 0 && <span>{writes} writes</span>}
                {execs > 0 && <span>{execs} commands</span>}
                {messages > 0 && <span>{messages} messages</span>}
                {other > 0 && <span>{other} other</span>}
                <span className="text-border">|</span>
                <span>avg risk <span className="text-secondary font-mono">{agent.avgRiskScore}</span></span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Two-column layout on desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: Recent activity */}
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display font-semibold text-primary text-sm">Recent Activity</h2>
            <Link
              to={`/activity?agent=${encodeURIComponent(agent.id)}`}
              className="text-xs text-accent hover:underline"
            >
              Live feed {"\u2192"}
            </Link>
          </div>
          {recentActivity.length === 0 ? (
            <div className="text-center py-10 text-muted text-sm bg-card border border-border rounded-2xl">
              No activity recorded yet
            </div>
          ) : (
            <div className="bg-card/50 border border-border/50 rounded-2xl divide-y divide-border/30 overflow-hidden">
              {recentActivity.map((entry, i) => (
                <EntryRow
                  key={entry.toolCallId || i}
                  entry={entry}
                  index={i}
                  showAgent={false}
                />
              ))}
            </div>
          )}
        </div>

        {/* Right column: Sessions */}
        <div>
          <h2 className="font-display font-semibold text-primary text-sm mb-3">
            Sessions
            <span className="text-muted font-normal ml-1.5">({totalSessions})</span>
          </h2>
          {sessions.length === 0 ? (
            <div className="text-center py-10 text-muted text-sm bg-card border border-border rounded-2xl">
              No sessions
            </div>
          ) : (
            <div className="space-y-2 stagger">
              {sessions.map((s) => (
                <SessionCard key={s.sessionKey} session={s} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
