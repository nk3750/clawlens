import { useParams, Link } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import type { AgentDetailResponse, EntryResponse } from "../lib/types";
import { relTime, agentColor } from "../lib/utils";
import AgentAvatar from "../components/AgentAvatar";
import RiskBar from "../components/RiskBar";
import ActivityChart from "../components/ActivityChart";
import EntryRow from "../components/EntryRow";
import SessionCard from "../components/SessionCard";

export default function AgentDetail() {
  const { agentId } = useParams<{ agentId: string }>();
  const { data, loading, error } = useApi<AgentDetailResponse>(
    `api/agent/${encodeURIComponent(agentId || "")}`,
  );
  // Get more entries for the activity chart
  const { data: allEntries } = useApi<EntryResponse[]>("api/entries?limit=200&offset=0");

  if (loading) {
    return (
      <div className="text-center py-20 text-muted">
        <div className="inline-block w-5 h-5 border-2 border-border border-t-accent rounded-full animate-spin mb-3" />
        <p className="text-sm">Loading\u2026</p>
      </div>
    );
  }
  if (error) return <div className="text-center py-20 text-risk-high text-sm">Error: {error}</div>;
  if (!data) return <div className="text-center py-20 text-muted text-sm">Agent not found</div>;

  const { agent, recentActivity, sessions, totalSessions } = data;
  const color = agentColor(agent.id);
  const isActive = agent.status === "active";

  // Filter entries for this agent's activity chart
  const agentEntries = allEntries?.filter((e) => e.agentId === agent.id) || [];

  // Simple breakdown
  const actionTypes = new Map<string, number>();
  for (const e of recentActivity) {
    actionTypes.set(e.toolName, (actionTypes.get(e.toolName) || 0) + 1);
  }

  return (
    <div className="max-w-3xl mx-auto">
      {/* Breadcrumb */}
      <div className="text-[11px] text-muted/50 mb-6 flex items-center gap-1.5">
        <Link to="/" className="hover:text-secondary transition-colors">ClawLens</Link>
        <span>{"\u203a"}</span>
        <span className="text-secondary">{agent.name}</span>
      </div>

      {/* Agent hero */}
      <div
        className="bg-card border rounded-2xl p-6 mb-6 animate-fade-in"
        style={{ borderColor: isActive ? `${color}25` : undefined }}
      >
        <div className="flex items-center gap-4 mb-4">
          <AgentAvatar agentId={agent.id} size="lg" showPulse={isActive} />
          <div className="flex-1 min-w-0">
            <h1 className="font-display font-bold text-primary text-xl">{agent.name}</h1>
            <p className="text-sm text-muted mt-0.5">
              {isActive ? (
                <>
                  <span className="text-status-active">Active</span>
                  {agent.currentSession && (
                    <> {"\u00b7"} running for {relTime(agent.currentSession.startTime).replace(" ago", "")}</>
                  )}
                </>
              ) : (
                <>Idle {"\u00b7"} {agent.lastActiveTimestamp ? `last seen ${relTime(agent.lastActiveTimestamp)}` : "no activity"}</>
              )}
            </p>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[10px] text-muted/40 mb-1">risk</div>
            <RiskBar score={agent.avgRiskScore} />
          </div>
        </div>

        {/* Quick stats */}
        <div className="flex items-center gap-4 text-xs text-muted border-t border-border/30 pt-3 flex-wrap">
          <span><span className="text-secondary font-mono">{agent.todayToolCalls}</span> actions today</span>
          {[...actionTypes.entries()].slice(0, 4).map(([tool, count]) => (
            <span key={tool} className="text-muted/60">{count} {tool}s</span>
          ))}
        </div>

        {/* Activity sparkline */}
        {agentEntries.length > 0 && (
          <div className="mt-4">
            <div className="text-[9px] text-muted/30 uppercase tracking-widest mb-1.5">24h activity</div>
            <ActivityChart entries={agentEntries} />
          </div>
        )}
      </div>

      {/* Current session */}
      {isActive && agent.currentSession && (
        <div className="mb-6 animate-fade-in">
          <Link
            to={`/session/${encodeURIComponent(agent.currentSession.sessionKey)}`}
            className="block p-4 bg-status-active/5 border border-status-active/15 rounded-2xl hover:border-status-active/25 transition-colors group"
          >
            <div className="flex items-center gap-2 mb-1">
              <div className="w-1.5 h-1.5 rounded-full bg-status-active animate-pulse" />
              <span className="text-xs font-display font-semibold text-status-active">Current Session</span>
            </div>
            <div className="font-mono text-[11px] text-muted/60 truncate group-hover:text-accent/60 transition-colors">
              {agent.currentSession.sessionKey}
            </div>
            <div className="text-xs text-muted mt-1">
              {agent.currentSession.toolCallCount} actions {"\u00b7"} started {relTime(agent.currentSession.startTime)}
            </div>
          </Link>
        </div>
      )}

      {/* Two columns on desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Activity feed */}
        <div className="lg:col-span-3">
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-[10px] text-muted/50 font-display font-semibold uppercase tracking-widest">
              Recent activity
            </span>
            <Link
              to={`/activity?agent=${encodeURIComponent(agent.id)}`}
              className="text-[11px] text-accent/70 hover:text-accent transition-colors"
            >
              Live feed {"\u2192"}
            </Link>
          </div>
          {recentActivity.length === 0 ? (
            <div className="text-center py-10 text-muted text-sm bg-card/40 border border-border/40 rounded-2xl">
              No activity yet
            </div>
          ) : (
            <div className="bg-card/40 border border-border/40 rounded-2xl divide-y divide-border/20 overflow-hidden">
              {recentActivity.map((entry, i) => (
                <EntryRow key={entry.toolCallId || i} entry={entry} index={i} showAgent={false} />
              ))}
            </div>
          )}
        </div>

        {/* Sessions */}
        <div className="lg:col-span-2">
          <span className="text-[10px] text-muted/50 font-display font-semibold uppercase tracking-widest mb-2.5 block px-1">
            Sessions ({totalSessions})
          </span>
          {sessions.length === 0 ? (
            <div className="text-center py-10 text-muted text-sm bg-card/40 border border-border/40 rounded-2xl">
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
