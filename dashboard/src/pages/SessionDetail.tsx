import { useParams, Link } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import type { SessionDetailResponse } from "../lib/types";
import { formatDuration, riskTierFromScore, agentColor } from "../lib/utils";
import AgentAvatar from "../components/AgentAvatar";
import RiskBadge from "../components/RiskBadge";
import EntryRow from "../components/EntryRow";

export default function SessionDetail() {
  const { sessionKey } = useParams<{ sessionKey: string }>();
  const { data, loading, error } = useApi<SessionDetailResponse>(
    `api/session/${encodeURIComponent(sessionKey || "")}`,
  );

  if (loading) {
    return (
      <div className="text-center py-20 text-muted">
        <div className="inline-block w-6 h-6 border-2 border-border border-t-accent rounded-full animate-spin mb-4" />
        <p className="text-sm font-display">Loading session\u2026</p>
      </div>
    );
  }
  if (error) return <div className="text-center py-20 text-risk-high">Error: {error}</div>;
  if (!data) return <div className="text-center py-20 text-muted">Session not found</div>;

  const { session, entries } = data;
  const riskTier = session.peakRisk ? riskTierFromScore(session.peakRisk) : undefined;
  const color = agentColor(session.agentId);

  // Action type breakdown
  const toolCounts = new Map<string, number>();
  for (const e of entries) {
    toolCounts.set(e.toolName, (toolCounts.get(e.toolName) || 0) + 1);
  }
  const breakdown = [...toolCounts.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="max-w-5xl mx-auto">
      {/* Breadcrumb */}
      <div className="text-xs text-muted mb-5 flex items-center gap-1.5 flex-wrap">
        <Link to="/" className="hover:text-secondary transition-colors">ClawLens</Link>
        <span className="text-muted/40">{"\u203a"}</span>
        <Link
          to={`/agent/${encodeURIComponent(session.agentId)}`}
          className="hover:text-secondary transition-colors"
        >
          {session.agentId}
        </Link>
        <span className="text-muted/40">{"\u203a"}</span>
        <span className="text-secondary">Session</span>
      </div>

      {/* Session hero */}
      <div
        className="bg-card border border-border rounded-2xl p-6 mb-6 animate-fade-in"
        style={{ borderLeftColor: color, borderLeftWidth: "3px" }}
      >
        <div className="flex items-start gap-4">
          <AgentAvatar agentId={session.agentId} size="lg" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap mb-1">
              <h1 className="font-display font-bold text-primary text-lg">
                Session by {session.agentId}
              </h1>
              <RiskBadge score={session.peakRisk || undefined} tier={riskTier} />
            </div>

            <div className="font-mono text-[11px] text-muted/60 mb-3 break-all">
              {session.sessionKey}
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <StatBlock label="Started" value={new Date(session.startTime).toLocaleTimeString()} />
              <StatBlock label="Duration" value={formatDuration(session.duration)} mono />
              <StatBlock label="Actions" value={String(session.toolCallCount)} mono />
              <StatBlock label="Avg Risk" value={session.avgRisk > 0 ? String(session.avgRisk) : "\u2014"} mono />
            </div>

            {/* Breakdown pills */}
            {breakdown.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {breakdown.map(([tool, count]) => (
                  <span
                    key={tool}
                    className="px-2 py-0.5 rounded-lg text-[11px] bg-surface text-muted border border-border/40"
                  >
                    {tool} <span className="text-secondary font-mono">{count}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display font-semibold text-primary text-sm">
          Timeline
          <span className="text-muted font-normal ml-1.5">({entries.length} actions)</span>
        </h2>
      </div>

      {entries.length === 0 ? (
        <div className="text-center py-12 text-muted text-sm bg-card border border-border rounded-2xl">
          No actions recorded in this session
        </div>
      ) : (
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-[19px] top-0 bottom-0 w-px bg-border/40 hidden sm:block" />

          <div className="bg-card/50 border border-border/50 rounded-2xl divide-y divide-border/30 overflow-hidden">
            {entries.map((entry, i) => (
              <EntryRow
                key={entry.toolCallId || i}
                entry={entry}
                index={i}
                showAgent={false}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatBlock({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] text-muted uppercase tracking-wider">{label}</div>
      <div className={`text-sm text-secondary ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}
