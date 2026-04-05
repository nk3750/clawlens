import { useApi } from "../hooks/useApi";
import type { AgentInfo, StatsResponse, EntryResponse } from "../lib/types";
import StatusHero from "../components/StatusHero";
import AgentCard from "../components/AgentCard";
import EntryRow from "../components/EntryRow";
import { Link } from "react-router-dom";

export default function Overview() {
  const { data: agents, loading } = useApi<AgentInfo[]>("api/agents");
  const { data: stats } = useApi<StatsResponse>("api/stats");
  const { data: entries } = useApi<EntryResponse[]>("api/entries?limit=20&offset=0");

  const activeAgents = agents?.filter((a) => a.status === "active") || [];
  const idleAgents = agents?.filter((a) => a.status === "idle") || [];

  return (
    <div className="max-w-3xl mx-auto">
      {/* Status Hero — answers "am I OK?" instantly */}
      <StatusHero
        stats={stats}
        entries={entries}
        agentCount={agents?.length || 0}
        activeCount={activeAgents.length}
      />

      {/* Loading */}
      {loading && (
        <div className="text-center py-12 text-muted animate-fade-in">
          <div className="inline-block w-5 h-5 border-2 border-border border-t-accent rounded-full animate-spin mb-3" />
          <p className="text-sm">Scanning for agents\u2026</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && agents && agents.length === 0 && (
        <div className="text-center py-16 text-muted animate-fade-in">
          <div className="w-14 h-14 rounded-2xl bg-surface border border-border flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-muted/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          </div>
          <p className="font-display font-semibold text-secondary mb-1">No agents yet</p>
          <p className="text-xs max-w-[280px] mx-auto leading-relaxed">
            Agent activity will appear here once ClawLens starts observing your OpenClaw agents.
          </p>
        </div>
      )}

      {/* Agents — simple list */}
      {agents && agents.length > 0 && (
        <div className="mb-8">
          {activeAgents.length > 0 && (
            <div className="mb-4">
              <div className="text-[10px] text-status-active/70 font-display font-semibold uppercase tracking-widest mb-2.5 flex items-center gap-2 px-1">
                <div className="w-1 h-1 rounded-full bg-status-active animate-pulse" />
                Active
              </div>
              <div className="space-y-2 stagger">
                {activeAgents.map((a) => (
                  <AgentCard key={a.id} agent={a} />
                ))}
              </div>
            </div>
          )}

          {idleAgents.length > 0 && (
            <div>
              <div className="text-[10px] text-muted/50 font-display font-semibold uppercase tracking-widest mb-2.5 px-1">
                Idle
              </div>
              <div className="space-y-2 stagger">
                {idleAgents.map((a) => (
                  <AgentCard key={a.id} agent={a} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Recent activity — just the last few */}
      {entries && entries.length > 0 && (
        <div className="animate-fade-in">
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-[10px] text-muted/50 font-display font-semibold uppercase tracking-widest">
              Recent
            </span>
            <Link to="/activity" className="text-[11px] text-accent/70 hover:text-accent transition-colors">
              See all {"\u2192"}
            </Link>
          </div>
          <div className="bg-card/40 border border-border/40 rounded-2xl divide-y divide-border/20 overflow-hidden">
            {entries.slice(0, 5).map((entry, i) => (
              <EntryRow key={entry.toolCallId || i} entry={entry} index={i} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
