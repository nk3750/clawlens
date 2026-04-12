import { useState, useMemo } from "react";
import { useApi } from "../hooks/useApi";
import type { AgentInfo, Guardrail, InterventionEntry, StatsResponse } from "../lib/types";
import FleetPulse from "../components/FleetPulse";
import NeedsAttention from "../components/NeedsAttention";
import AgentRow from "../components/AgentCardCompact";
import ActivityTimeline from "../components/ActivityTimeline";
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

  // Sort: needsAttention first, then by todayToolCalls desc
  const sortedAgents = useMemo(() => {
    if (!agents) return [];
    return [...agents].sort((a, b) => {
      if (a.needsAttention !== b.needsAttention) return a.needsAttention ? -1 : 1;
      return b.todayToolCalls - a.todayToolCalls;
    });
  }, [agents]);

  const activeAgents = useMemo(() => sortedAgents.filter((a) => a.todayToolCalls > 0), [sortedAgents]);
  const idleAgents = useMemo(() => sortedAgents.filter((a) => a.todayToolCalls === 0), [sortedAgents]);

  const dateLabel = selectedDate
    ? new Date(`${selectedDate}T12:00:00`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })
    : undefined;

  return (
    <div className="page-enter flex flex-col" style={{ gap: "clamp(20px, 3vw, 32px)" }}>
      {/* Fleet Pulse */}
      {stats && (
        <FleetPulse
          stats={stats}
          totalAgents={agents?.length ?? 0}
          guardrailCount={guardrails.length}
          selectedDate={selectedDate}
          onDateChange={setSelectedDate}
        />
      )}

      {/* Needs Attention */}
      {interventions && agents && (
        <NeedsAttention interventions={interventions} agents={agents} />
      )}

      {/* Agent Rows */}
      <section>
        <div className="mb-3">
          <span className="font-display text-sm font-medium" style={{ color: "var(--cl-text-secondary)" }}>
            Agents
          </span>
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

        {/* Agent grid */}
        {(activeAgents.length > 0 || idleAgents.length > 0) && (
          <div
            className="grid"
            style={{
              gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
              gap: 8,
            }}
          >
            {activeAgents.map((agent) => (
              <AgentRow key={agent.id} agent={agent} />
            ))}
            {idleAgents.map((agent) => (
              <AgentRow key={agent.id} agent={agent} />
            ))}
          </div>
        )}
      </section>

      {/* Activity Timeline */}
      <ActivityTimeline isToday={isToday} selectedDate={selectedDate} />
    </div>
  );
}
