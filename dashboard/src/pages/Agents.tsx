import { useState, useMemo } from "react";
import { useApi } from "../hooks/useApi";
import type { AgentInfo, Guardrail, InterventionEntry, StatsResponse } from "../lib/types";
import FleetPulse from "../components/FleetPulse";
import NeedsAttention from "../components/NeedsAttention";
import AgentCardCompact from "../components/AgentCardCompact";
import LiveFeed from "../components/LiveFeed";
import ErrorCard from "../components/ErrorCard";

export default function Agents() {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const isToday = selectedDate === null;
  const dateParam = selectedDate ? `?date=${selectedDate}` : "";

  const statsPath = useMemo(() => `api/stats${dateParam}`, [dateParam]);
  const agentsPath = useMemo(() => `api/agents${dateParam}`, [dateParam]);
  const interventionsPath = useMemo(() => `api/interventions${dateParam}`, [dateParam]);

  const { data: stats } = useApi<StatsResponse>(statsPath);
  const { data: agents, loading, error, refetch } = useApi<AgentInfo[]>(agentsPath);
  const { data: interventions } = useApi<InterventionEntry[]>(interventionsPath);
  const { data: guardrailsData } = useApi<{ guardrails: Guardrail[] }>("api/guardrails");

  const guardrails = guardrailsData?.guardrails ?? [];

  // Sort: needsAttention first, then by peakRiskScore desc
  const sortedAgents = useMemo(() => {
    if (!agents) return [];
    return [...agents].sort((a, b) => {
      if (a.needsAttention !== b.needsAttention) return a.needsAttention ? -1 : 1;
      return b.peakRiskScore - a.peakRiskScore;
    });
  }, [agents]);

  // Per-agent guardrail counts: agent-specific + globals (agentId === null)
  const guardrailCounts = useMemo(() => {
    const counts = new Map<string, number>();
    const globalCount = guardrails.filter((g) => g.agentId === null).length;
    for (const agent of agents ?? []) {
      const agentSpecific = guardrails.filter((g) => g.agentId === agent.id).length;
      counts.set(agent.id, agentSpecific + globalCount);
    }
    return counts;
  }, [agents, guardrails]);

  const dateLabel = selectedDate
    ? new Date(`${selectedDate}T12:00:00`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })
    : undefined;

  return (
    <div className="page-enter">
      {/* Fleet Pulse */}
      {stats && (
        <FleetPulse
          stats={stats}
          guardrailCount={guardrails.length}
          selectedDate={selectedDate}
          onDateChange={setSelectedDate}
        />
      )}

      {/* Needs Attention */}
      {interventions && agents && (
        <NeedsAttention interventions={interventions} agents={agents} />
      )}

      {/* Agent Cards Grid */}
      <section style={{ marginTop: "clamp(16px, 2vw, 28px)" }}>
        <div className="flex items-center gap-3 mb-4">
          <span className="label-mono" style={{ color: "var(--cl-text-muted)" }}>
            AGENTS
          </span>
          {agents && (
            <span
              className="font-mono text-[10px]"
              style={{ color: "var(--cl-text-muted)", opacity: 0.4 }}
            >
              {agents.length}
            </span>
          )}
        </div>

        {/* Loading */}
        {loading && !agents && (
          <p className="text-sm py-8 text-center" style={{ color: "var(--cl-text-muted)" }}>
            Loading...
          </p>
        )}

        {/* Error */}
        {error && !agents && <ErrorCard message={error} onRetry={refetch} />}

        {/* Empty state */}
        {!loading && !error && agents && agents.length === 0 && (
          <div className="flex flex-col items-center justify-center text-center py-12">
            <p
              className="font-display"
              style={{
                color: "var(--cl-text-muted)",
                fontSize: "var(--text-subhead)",
              }}
            >
              {isToday ? "No agents yet" : `No agent activity on ${dateLabel}`}
            </p>
            {isToday && (
              <p
                className="text-sm mt-3 max-w-sm"
                style={{ color: "var(--cl-text-muted)", opacity: 0.6 }}
              >
                ClawLens is watching — activity will appear here once agents start.
              </p>
            )}
          </div>
        )}

        {/* Agent cards */}
        {sortedAgents.length > 0 && (
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}
          >
            {sortedAgents.map((agent) => (
              <AgentCardCompact
                key={agent.id}
                agent={agent}
                guardrailCount={guardrailCounts.get(agent.id) ?? 0}
              />
            ))}
          </div>
        )}
      </section>

      {/* Live Feed */}
      <LiveFeed isToday={isToday} selectedDate={selectedDate} />
    </div>
  );
}
