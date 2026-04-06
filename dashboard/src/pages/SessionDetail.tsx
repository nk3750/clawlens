import { useParams, Link } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import type { SessionDetailResponse } from "../lib/types";
import { formatDuration, relTime } from "../lib/utils";
import GradientAvatar from "../components/GradientAvatar";
import DecisionBadge from "../components/DecisionBadge";

export default function SessionDetail() {
  const { sessionKey } = useParams<{ sessionKey: string }>();
  const { data, loading, error } = useApi<SessionDetailResponse>(
    `api/session/${encodeURIComponent(sessionKey || "")}`,
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
        {error ? `Error: ${error}` : "Session not found"}
        <br />
        <Link to="/" className="text-sm mt-2 inline-block" style={{ color: "var(--cl-accent)" }}>
          &larr; Back to Agents
        </Link>
      </div>
    );
  }

  const { session, entries } = data;

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm mb-6" style={{ color: "var(--cl-text-muted)" }}>
        <Link to="/" className="hover:underline">Agents</Link>
        <span>&rsaquo;</span>
        <Link to={`/agent/${encodeURIComponent(session.agentId)}`} className="hover:underline">
          {session.agentId}
        </Link>
        <span>&rsaquo;</span>
        <span style={{ color: "var(--cl-text-secondary)" }}>Session</span>
      </div>

      {/* Session header */}
      <div
        className="rounded-xl border p-6 mb-8"
        style={{
          backgroundColor: "var(--cl-surface)",
          borderColor: "var(--cl-border-default)",
        }}
      >
        <div className="flex items-center gap-4 mb-4">
          <GradientAvatar agentId={session.agentId} />
          <div>
            <h1
              className="font-display font-bold text-lg"
              style={{ color: "var(--cl-text-primary)" }}
            >
              Session by {session.agentId}
            </h1>
            <span className="font-mono text-xs" style={{ color: "var(--cl-text-secondary)" }}>
              {new Date(session.startTime).toLocaleString()}
            </span>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <StatCard label="Actions" value={String(session.toolCallCount)} />
          <StatCard label="Duration" value={formatDuration(session.duration)} />
          <StatCard label="Peak Risk" value={String(session.peakRisk)} />
        </div>
      </div>

      {/* Timeline */}
      <h2
        className="label-mono mb-4"
        style={{ color: "var(--cl-text-muted)" }}
      >
        TIMELINE ({entries.length} actions)
      </h2>
      <div
        className="rounded-xl border divide-y overflow-hidden"
        style={{
          backgroundColor: "var(--cl-surface)",
          borderColor: "var(--cl-border-subtle)",
        }}
      >
        {entries.length === 0 ? (
          <p className="p-6 text-center" style={{ color: "var(--cl-text-muted)" }}>
            No actions in this session
          </p>
        ) : (
          entries.map((entry, i) => (
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
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-lg p-3"
      style={{ backgroundColor: "var(--cl-elevated)" }}
    >
      <div className="label-mono mb-1" style={{ color: "var(--cl-text-muted)" }}>
        {label}
      </div>
      <div className="font-mono text-sm" style={{ color: "var(--cl-text-primary)" }}>
        {value}
      </div>
    </div>
  );
}
