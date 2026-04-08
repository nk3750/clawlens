import { useState, useMemo } from "react";
import { useApi } from "../hooks/useApi";
import type { AgentInfo, InterventionEntry, StatsResponse } from "../lib/types";
import DateNavigator from "../components/DateNavigator";
import FleetRings from "../components/FleetRings";
import FleetBriefing from "../components/FleetBriefing";
import HexConstellation from "../components/HexConstellation";
import InterventionsPanel from "../components/InterventionsPanel";
import ErrorCard from "../components/ErrorCard";
import { ConstellationSkeleton } from "../components/Skeleton";

function formatDateLabel(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function Agents() {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const isToday = selectedDate === null;
  const dateParam = selectedDate ? `?date=${selectedDate}` : "";
  const dateLabel = selectedDate ? formatDateLabel(selectedDate) : undefined;

  // API calls with date param
  const statsPath = useMemo(() => `api/stats${dateParam}`, [dateParam]);
  const agentsPath = useMemo(() => `api/agents${dateParam}`, [dateParam]);
  const interventionsPath = useMemo(
    () => `api/interventions${dateParam}`,
    [dateParam],
  );

  const { data: stats } = useApi<StatsResponse>(statsPath);
  const {
    data: agents,
    loading,
    error,
    refetch,
  } = useApi<AgentInfo[]>(agentsPath);
  const { data: interventions } = useApi<InterventionEntry[]>(interventionsPath);

  return (
    <div className="page-enter">
      {/* Date navigator */}
      <DateNavigator selectedDate={selectedDate} onDateChange={setSelectedDate} />

      {/* Fleet rings (replaces RiskPulse) */}
      {stats && <FleetRings stats={stats} isToday={isToday} />}

      {/* Fleet briefing */}
      {stats && agents && (
        <div style={{ marginTop: "clamp(12px, 1.5vw, 24px)" }}>
          <FleetBriefing
            stats={stats}
            agents={agents}
            isToday={isToday}
            dateLabel={dateLabel}
          />
        </div>
      )}

      {/* Divider */}
      <div className="cl-divider" style={{ marginTop: "clamp(16px, 2vw, 32px)" }} />

      {/* Agent constellation */}
      <section style={{ marginTop: "clamp(16px, 2vw, 32px)" }}>
        <div className="flex items-center gap-3 mb-6">
          <span
            className="label-mono"
            style={{ color: "var(--cl-text-muted)" }}
          >
            Your agents
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

        {/* Loading skeleton */}
        {loading && !agents && <ConstellationSkeleton />}

        {/* Error state */}
        {error && !agents && <ErrorCard message={error} onRetry={refetch} />}

        {/* Empty state */}
        {!loading && !error && agents && agents.length === 0 && (
          <div
            className="flex flex-col items-center justify-center text-center"
            style={{ height: 400 }}
          >
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
                ClawLens is watching — activity will appear here once agents
                start.
              </p>
            )}
          </div>
        )}

        {agents && agents.length > 0 && <HexConstellation agents={agents} />}
      </section>

      {/* Interventions panel */}
      {interventions && (
        <InterventionsPanel
          interventions={interventions}
          isToday={isToday}
          dateLabel={dateLabel}
        />
      )}
    </div>
  );
}
