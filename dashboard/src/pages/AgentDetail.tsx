import { useParams, Link } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import type { AgentDetailResponse, SessionInfo } from "../lib/types";
import { relTime, formatDuration, riskTierFromScore } from "../lib/utils";
import EntryRow from "../components/EntryRow";
import RiskBadge from "../components/RiskBadge";

export default function AgentDetail() {
  const { agentId } = useParams<{ agentId: string }>();
  const { data, loading, error } = useApi<AgentDetailResponse>(
    `api/agent/${encodeURIComponent(agentId || "")}`,
  );

  if (loading) {
    return (
      <div className="text-center py-16 text-muted">
        <div className="inline-block w-5 h-5 border-2 border-border border-t-accent rounded-full animate-spin mb-3" />
        <p className="text-sm">Loading agent...</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="text-center py-16 text-red-400">Error: {error}</div>
    );
  }
  if (!data) {
    return (
      <div className="text-center py-16 text-muted">Agent not found</div>
    );
  }

  const { agent, recentActivity, sessions, totalSessions } = data;
  const riskTier = agent.peakRiskScore
    ? riskTierFromScore(agent.peakRiskScore)
    : undefined;

  return (
    <div>
      {/* Breadcrumb */}
      <div className="text-xs text-muted mb-4 flex items-center gap-1.5">
        <Link to="/" className="hover:text-secondary transition-colors">
          ClawLens
        </Link>
        <span>{"\u203a"}</span>
        <span className="text-secondary">Agent: {agent.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-center gap-3 mb-6 animate-fade-in">
        <div
          className={`w-3 h-3 rounded-full shrink-0 ${
            agent.status === "active"
              ? "bg-status-active animate-status-pulse"
              : "bg-status-idle"
          }`}
        />
        <h1 className="font-display font-bold text-primary text-xl">
          {agent.name}
        </h1>
        <RiskBadge score={agent.peakRiskScore || undefined} tier={riskTier} />
        <span
          className={`text-xs ${
            agent.status === "active" ? "text-status-active" : "text-muted"
          }`}
        >
          {agent.status}
        </span>
        <span className="ml-auto text-xs text-muted">
          {agent.todayToolCalls} calls today
        </span>
      </div>

      {/* Current session */}
      {agent.currentSession && (
        <div className="bg-card border border-border rounded-xl p-4 mb-6 animate-fade-in border-l-2 border-l-status-active/40">
          <h2 className="font-display font-semibold text-primary text-sm mb-3">
            Active Session
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div>
              <div className="text-muted mb-0.5">Session</div>
              <Link
                to={`/session/${encodeURIComponent(agent.currentSession.sessionKey)}`}
                className="font-mono text-accent hover:underline break-all text-[11px]"
              >
                {agent.currentSession.sessionKey}
              </Link>
            </div>
            <div>
              <div className="text-muted mb-0.5">Started</div>
              <div className="text-secondary">
                {relTime(agent.currentSession.startTime)}
              </div>
            </div>
            <div>
              <div className="text-muted mb-0.5">Tool Calls</div>
              <div className="text-secondary font-mono">
                {agent.currentSession.toolCallCount}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Recent Activity */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display font-semibold text-primary text-sm">
            Recent Activity
          </h2>
          <Link
            to={`/activity?agent=${encodeURIComponent(agent.id)}`}
            className="text-xs text-accent hover:underline"
          >
            View all {"\u2192"}
          </Link>
        </div>
        {recentActivity.length === 0 ? (
          <div className="text-center py-8 text-muted text-sm bg-card border border-border rounded-xl">
            No activity recorded
          </div>
        ) : (
          <div className="space-y-1.5">
            {recentActivity.map((entry, i) => (
              <EntryRow
                key={entry.toolCallId || i}
                entry={entry}
                index={i}
              />
            ))}
          </div>
        )}
      </div>

      {/* Session History */}
      <div>
        <h2 className="font-display font-semibold text-primary text-sm mb-3">
          Session History
          <span className="text-muted font-normal ml-2">
            ({totalSessions})
          </span>
        </h2>
        {sessions.length === 0 ? (
          <div className="text-center py-8 text-muted text-sm bg-card border border-border rounded-xl">
            No sessions recorded
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl overflow-hidden animate-fade-in">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wider font-display">
                      Session
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wider font-display hidden md:table-cell">
                      Duration
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wider font-display">
                      Calls
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wider font-display">
                      Avg Risk
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wider font-display hidden md:table-cell">
                      Peak
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <SessionRow key={s.sessionKey} session={s} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SessionRow({ session }: { session: SessionInfo }) {
  const riskTier = session.peakRisk
    ? riskTierFromScore(session.peakRisk)
    : undefined;

  return (
    <tr className="border-b border-border/50 hover:bg-elevated/30 transition-colors">
      <td className="px-4 py-3">
        <Link
          to={`/session/${encodeURIComponent(session.sessionKey)}`}
          className="font-mono text-xs text-accent hover:underline break-all"
        >
          {session.sessionKey}
        </Link>
        <div className="text-[11px] text-muted mt-0.5">
          {relTime(session.startTime)}
        </div>
      </td>
      <td className="px-4 py-3 text-muted hidden md:table-cell font-mono text-xs">
        {formatDuration(session.duration)}
      </td>
      <td className="px-4 py-3 text-secondary font-mono">
        {session.toolCallCount}
      </td>
      <td className="px-4 py-3">
        <RiskBadge score={session.avgRisk || undefined} tier={riskTier} />
      </td>
      <td className="px-4 py-3 hidden md:table-cell">
        <RiskBadge score={session.peakRisk || undefined} tier={riskTier} />
      </td>
    </tr>
  );
}
