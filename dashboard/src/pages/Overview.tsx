import { useApi } from "../hooks/useApi";
import type { AgentInfo, StatsResponse, EntryResponse } from "../lib/types";
import AgentCard from "../components/AgentCard";
import EntryRow from "../components/EntryRow";
import { Link } from "react-router-dom";

export default function Overview() {
  const { data: agents, loading } = useApi<AgentInfo[]>("api/agents");
  const { data: stats } = useApi<StatsResponse>("api/stats");
  const { data: recentEntries } = useApi<EntryResponse[]>("api/entries?limit=30&offset=0");

  const activeAgents = agents?.filter((a) => a.status === "active") || [];
  const idleAgents = agents?.filter((a) => a.status === "idle") || [];

  // Group recent entries by agent for the station cards
  const entriesByAgent = new Map<string, EntryResponse[]>();
  if (recentEntries) {
    for (const e of recentEntries) {
      const id = e.agentId || "default";
      const list = entriesByAgent.get(id) || [];
      list.push(e);
      entriesByAgent.set(id, list);
    }
  }

  // Attention items
  const pendingCount = stats?.pending || 0;
  const highRiskCount = recentEntries?.filter(
    (e) => e.riskScore != null && e.riskScore > 60,
  ).length || 0;
  const needsAttention = pendingCount > 0 || highRiskCount > 0;

  return (
    <div className="max-w-5xl mx-auto">
      {/* Page header */}
      <div className="mb-8 animate-fade-in">
        <h1 className="font-display font-bold text-primary text-2xl mb-1">
          Agent Observatory
        </h1>
        <p className="text-sm text-muted">
          {agents ? (
            <>
              Watching{" "}
              <span className="text-secondary">{agents.length} agent{agents.length !== 1 ? "s" : ""}</span>
              {stats && (
                <>
                  {" "}{"\u00b7"}{" "}
                  <span className="text-secondary">{stats.total}</span> actions today
                </>
              )}
              {activeAgents.length > 0 && (
                <>
                  {" "}{"\u00b7"}{" "}
                  <span className="text-status-active">{activeAgents.length} active</span>
                </>
              )}
            </>
          ) : (
            "Loading\u2026"
          )}
        </p>
      </div>

      {/* Attention banner */}
      {needsAttention && (
        <div className="mb-6 p-4 bg-risk-high/5 border border-risk-high/15 rounded-2xl animate-fade-in flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-risk-high/10 flex items-center justify-center shrink-0">
            <svg className="w-4 h-4 text-risk-high" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {pendingCount > 0 && (
              <span className="text-risk-medium">
                {pendingCount} action{pendingCount !== 1 ? "s" : ""} awaiting approval
              </span>
            )}
            {highRiskCount > 0 && (
              <span className="text-risk-high">
                {highRiskCount} high-risk action{highRiskCount !== 1 ? "s" : ""} flagged
              </span>
            )}
          </div>
          <Link
            to="/activity"
            className="ml-auto text-xs text-accent hover:underline shrink-0"
          >
            Review {"\u2192"}
          </Link>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="text-center py-20 text-muted">
          <div className="inline-block w-6 h-6 border-2 border-border border-t-accent rounded-full animate-spin mb-4" />
          <p className="text-sm font-display">Scanning for agents\u2026</p>
        </div>
      )}

      {/* Empty */}
      {!loading && agents && agents.length === 0 && (
        <div className="text-center py-20 text-muted animate-fade-in">
          <div className="w-16 h-16 rounded-2xl bg-surface border border-border flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-muted/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          </div>
          <p className="font-display font-semibold text-secondary text-base mb-1">No agents detected</p>
          <p className="text-xs max-w-xs mx-auto">
            Agent activity will appear here once ClawLens starts observing tool calls from your OpenClaw agents.
          </p>
        </div>
      )}

      {/* Agent stations */}
      {agents && agents.length > 0 && (
        <div className="stagger">
          {/* Active agents first, prominently */}
          {activeAgents.length > 0 && (
            <div className="mb-2">
              <div className="text-[11px] text-status-active font-display font-semibold uppercase tracking-wider mb-3 flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-status-active animate-pulse" />
                Active now
              </div>
              <div className="grid grid-cols-1 gap-3 mb-6">
                {activeAgents.map((agent) => (
                  <AgentCard
                    key={agent.id}
                    agent={agent}
                    recentActions={entriesByAgent.get(agent.id)?.slice(0, 4)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Idle agents */}
          {idleAgents.length > 0 && (
            <div>
              <div className="text-[11px] text-muted font-display font-semibold uppercase tracking-wider mb-3">
                Idle
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
                {idleAgents.map((agent) => (
                  <AgentCard
                    key={agent.id}
                    agent={agent}
                    recentActions={entriesByAgent.get(agent.id)?.slice(0, 3)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Latest activity ticker */}
      {recentEntries && recentEntries.length > 0 && (
        <div className="mt-4 animate-fade-in">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[11px] text-muted font-display font-semibold uppercase tracking-wider">
              Latest across all agents
            </h2>
            <Link to="/activity" className="text-xs text-accent hover:underline">
              View all {"\u2192"}
            </Link>
          </div>
          <div className="bg-card/50 border border-border/50 rounded-2xl divide-y divide-border/30 overflow-hidden">
            {recentEntries.slice(0, 5).map((entry, i) => (
              <EntryRow key={entry.toolCallId || i} entry={entry} index={i} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
