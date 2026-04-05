import { useParams, Link } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import type { SessionDetailResponse } from "../lib/types";
import { formatDuration, agentColor } from "../lib/utils";
import AgentAvatar from "../components/AgentAvatar";
import RiskBar from "../components/RiskBar";
import EntryRow from "../components/EntryRow";

export default function SessionDetail() {
  const { sessionKey } = useParams<{ sessionKey: string }>();
  const { data, loading, error } = useApi<SessionDetailResponse>(
    `api/session/${encodeURIComponent(sessionKey || "")}`,
  );

  if (loading) {
    return (
      <div className="text-center py-20 text-muted">
        <div className="inline-block w-5 h-5 border-2 border-border border-t-accent rounded-full animate-spin mb-3" />
        <p className="text-sm">Loading\u2026</p>
      </div>
    );
  }
  if (error) return <div className="text-center py-20 text-risk-high text-sm">Error: {error}</div>;
  if (!data) return <div className="text-center py-20 text-muted text-sm">Session not found</div>;

  const { session, entries } = data;
  const color = agentColor(session.agentId);

  // Action breakdown
  const toolCounts = new Map<string, number>();
  for (const e of entries) {
    toolCounts.set(e.toolName, (toolCounts.get(e.toolName) || 0) + 1);
  }

  return (
    <div className="max-w-3xl mx-auto">
      {/* Breadcrumb */}
      <div className="text-[11px] text-muted/50 mb-6 flex items-center gap-1.5 flex-wrap">
        <Link to="/" className="hover:text-secondary transition-colors">ClawLens</Link>
        <span>{"\u203a"}</span>
        <Link to={`/agent/${encodeURIComponent(session.agentId)}`} className="hover:text-secondary transition-colors">
          {session.agentId}
        </Link>
        <span>{"\u203a"}</span>
        <span className="text-secondary">Session</span>
      </div>

      {/* Session header */}
      <div
        className="bg-card border border-border rounded-2xl p-6 mb-6 animate-fade-in"
        style={{ borderLeftColor: color, borderLeftWidth: "3px" }}
      >
        <div className="flex items-center gap-4 mb-4">
          <AgentAvatar agentId={session.agentId} size="lg" />
          <div className="flex-1 min-w-0">
            <h1 className="font-display font-bold text-primary text-lg">
              Session by {session.agentId}
            </h1>
            <div className="font-mono text-[10px] text-muted/40 truncate mt-0.5">
              {session.sessionKey}
            </div>
          </div>
          <div className="shrink-0">
            <RiskBar score={session.peakRisk || 0} />
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 border-t border-border/30 pt-3">
          <div>
            <div className="text-[10px] text-muted/40 uppercase tracking-wider">Duration</div>
            <div className="text-sm text-secondary font-mono">{formatDuration(session.duration)}</div>
          </div>
          <div>
            <div className="text-[10px] text-muted/40 uppercase tracking-wider">Actions</div>
            <div className="text-sm text-secondary font-mono">{session.toolCallCount}</div>
          </div>
          <div>
            <div className="text-[10px] text-muted/40 uppercase tracking-wider">Started</div>
            <div className="text-sm text-secondary">{new Date(session.startTime).toLocaleTimeString()}</div>
          </div>
        </div>

        {/* Action type pills */}
        {toolCounts.size > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {[...toolCounts.entries()].map(([tool, count]) => (
              <span key={tool} className="px-2 py-0.5 rounded-lg text-[11px] bg-surface text-muted border border-border/30">
                {tool} <span className="text-secondary font-mono">{count}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Timeline */}
      <div className="flex items-center mb-2 px-1">
        <span className="text-[10px] text-muted/50 font-display font-semibold uppercase tracking-widest">
          Timeline ({entries.length} actions)
        </span>
      </div>

      {entries.length === 0 ? (
        <div className="text-center py-12 text-muted text-sm bg-card/40 border border-border/40 rounded-2xl">
          No actions in this session
        </div>
      ) : (
        <div className="bg-card/40 border border-border/40 rounded-2xl divide-y divide-border/20 overflow-hidden">
          {entries.map((entry, i) => (
            <EntryRow key={entry.toolCallId || i} entry={entry} index={i} showAgent={false} />
          ))}
        </div>
      )}
    </div>
  );
}
