import { useParams, Link } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import type { SessionDetailResponse } from "../lib/types";
import { formatDuration, riskTierFromScore } from "../lib/utils";
import EntryRow from "../components/EntryRow";
import RiskBadge from "../components/RiskBadge";

export default function SessionDetail() {
  const { sessionKey } = useParams<{ sessionKey: string }>();
  const { data, loading, error } = useApi<SessionDetailResponse>(
    `api/session/${encodeURIComponent(sessionKey || "")}`,
  );

  if (loading) {
    return (
      <div className="text-center py-16 text-muted">
        <div className="inline-block w-5 h-5 border-2 border-border border-t-accent rounded-full animate-spin mb-3" />
        <p className="text-sm">Loading session...</p>
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
      <div className="text-center py-16 text-muted">Session not found</div>
    );
  }

  const { session, entries } = data;
  const riskTier = session.peakRisk
    ? riskTierFromScore(session.peakRisk)
    : undefined;

  return (
    <div>
      {/* Breadcrumb */}
      <div className="text-xs text-muted mb-4 flex items-center gap-1.5 flex-wrap">
        <Link to="/" className="hover:text-secondary transition-colors">
          ClawLens
        </Link>
        <span>{"\u203a"}</span>
        <Link
          to={`/agent/${encodeURIComponent(session.agentId)}`}
          className="hover:text-secondary transition-colors"
        >
          Agent: {session.agentId}
        </Link>
        <span>{"\u203a"}</span>
        <span className="text-secondary">Session</span>
      </div>

      {/* Header card */}
      <div className="bg-card border border-border rounded-xl p-5 mb-6 animate-fade-in">
        <div className="flex items-center gap-3 mb-3">
          <h1 className="font-display font-bold text-primary text-lg">
            Session Detail
          </h1>
          <RiskBadge
            score={session.peakRisk || undefined}
            tier={riskTier}
          />
        </div>
        <div className="font-mono text-xs text-muted mb-4 break-all bg-surface rounded-lg px-3 py-2 border border-border/50">
          {session.sessionKey}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-xs">
          <div>
            <div className="text-muted mb-0.5">Agent</div>
            <Link
              to={`/agent/${encodeURIComponent(session.agentId)}`}
              className="text-accent hover:underline font-display font-medium"
            >
              {session.agentId}
            </Link>
          </div>
          <div>
            <div className="text-muted mb-0.5">Started</div>
            <div className="text-secondary">
              {new Date(session.startTime).toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-muted mb-0.5">Duration</div>
            <div className="text-secondary font-mono">
              {formatDuration(session.duration)}
            </div>
          </div>
          <div>
            <div className="text-muted mb-0.5">Tool Calls</div>
            <div className="text-secondary font-mono">
              {session.toolCallCount}
            </div>
          </div>
          <div>
            <div className="text-muted mb-0.5">Avg Risk</div>
            <RiskBadge
              score={session.avgRisk || undefined}
              tier={riskTier}
            />
          </div>
        </div>
      </div>

      {/* Timeline */}
      <h2 className="font-display font-semibold text-primary text-sm mb-3">
        Timeline
        <span className="text-muted font-normal ml-2">
          ({entries.length} events)
        </span>
      </h2>
      {entries.length === 0 ? (
        <div className="text-center py-8 text-muted text-sm bg-card border border-border rounded-xl">
          No events in this session
        </div>
      ) : (
        <div className="space-y-1.5">
          {entries.map((entry, i) => (
            <EntryRow
              key={entry.toolCallId || i}
              entry={entry}
              index={i}
            />
          ))}
        </div>
      )}
    </div>
  );
}
