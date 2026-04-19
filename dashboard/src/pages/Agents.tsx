import { useState, useMemo, useCallback } from "react";
import { useLiveApi } from "../hooks/useLiveApi";
import type { AgentInfo, AttentionResponse, Guardrail, StatsResponse } from "../lib/types";
import FleetHeader from "../components/FleetHeader";
import AttentionInbox from "../components/AttentionInbox";
import AgentRow from "../components/AgentCardCompact";
import FleetChart from "../components/FleetChart/FleetChart";
import LiveFeed from "../components/LiveFeed";
import ErrorCard from "../components/ErrorCard";
import DormantState from "../components/DormantState";
import { isDormant } from "../lib/homepageState";
import { isRangeOption, type RangeOption } from "../components/fleetheader/utils";
import { getPref, PREF_KEYS, setPref } from "../lib/prefs";

const DEFAULT_RANGE: RangeOption = "12h";

function readInitialRange(): RangeOption {
  const stored = getPref<string | null>(PREF_KEYS.FLEET_RANGE, null);
  return isRangeOption(stored) ? stored : DEFAULT_RANGE;
}

export default function Agents() {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [range, setRangeState] = useState<RangeOption>(readInitialRange);
  const [showIdle, setShowIdle] = useState(false);
  const isToday = selectedDate === null;
  const dateParam = selectedDate ? `?date=${selectedDate}` : "";

  const statsPath = useMemo(() => `api/stats${dateParam}`, [dateParam]);
  const agentsPath = useMemo(() => `api/agents${dateParam}`, [dateParam]);
  const attentionPath = useMemo(() => `api/attention${dateParam}`, [dateParam]);

  const { data: stats } = useLiveApi<StatsResponse>(statsPath);
  const { data: agents, loading, error, refetch } = useLiveApi<AgentInfo[]>(agentsPath);
  // Attention only changes on pending/blocked/timeout/high-risk entries; gate
  // the SSE-driven refetch so we don't hammer the API on every low-risk allow.
  // High-risk threshold (65) matches the cutoff used in api.ts → getAttention.
  const { data: attention, refetch: refetchAttention } = useLiveApi<AttentionResponse>(
    attentionPath,
    {
      filter: (e) => {
        const eff = e.effectiveDecision;
        const score = e.riskScore ?? 0;
        return eff === "pending" || eff === "block" || eff === "timeout" || score >= 65;
      },
    },
  );
  const { data: guardrailsData } = useLiveApi<{ guardrails: Guardrail[] }>("api/guardrails");

  const guardrails = guardrailsData?.guardrails ?? [];
  const pendingCount = attention?.pending.length ?? 0;

  // Cross-reference attention-flagged agents so AgentCardCompact can show a
  // sidelight without re-deriving from its own AgentInfo snapshot.
  const attentionAgentIds = useMemo(
    () => new Set(attention?.agentAttention.map((a) => a.agentId) ?? []),
    [attention],
  );

  const onRangeChange = useCallback((next: RangeOption) => {
    setRangeState(next);
    setPref(PREF_KEYS.FLEET_RANGE, next);
  }, []);

  // Sort: attention-flagged agents first, then by todayToolCalls desc.
  const sortedAgents = useMemo(() => {
    if (!agents) return [];
    return [...agents].sort((a, b) => {
      const aFlag = attentionAgentIds.has(a.id);
      const bFlag = attentionAgentIds.has(b.id);
      if (aFlag !== bFlag) return aFlag ? -1 : 1;
      return b.todayToolCalls - a.todayToolCalls;
    });
  }, [agents, attentionAgentIds]);

  const activeAgents = useMemo(() => sortedAgents.filter((a) => a.todayToolCalls > 0), [sortedAgents]);
  const idleAgents = useMemo(() => sortedAgents.filter((a) => a.todayToolCalls === 0), [sortedAgents]);

  const dateLabel = selectedDate
    ? new Date(`${selectedDate}T12:00:00`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })
    : undefined;

  if (isDormant(stats) === true) {
    return (
      <div className="page-enter">
        <DormantState />
      </div>
    );
  }

  return (
    <div className="page-enter flex flex-col" style={{ gap: "var(--cl-section-gap)" }}>
      {/* Fleet Header — replaces FleetPulse */}
      {stats && (
        <FleetHeader
          stats={stats}
          totalAgents={agents?.length ?? 0}
          guardrailCount={guardrails.length}
          pendingCount={pendingCount}
          selectedDate={selectedDate}
          onDateChange={setSelectedDate}
          range={range}
          onRangeChange={onRangeChange}
        />
      )}

      {/* Attention Inbox (homepage-v3-attention-inbox-spec) */}
      <div data-cl-inbox-pending-anchor data-cl-inbox-blocked-anchor>
        <AttentionInbox data={attention} refetch={refetchAttention} />
      </div>

      {/* Fleet Chart — range is driven by FleetHeader */}
      <div data-cl-fleet-chart-anchor>
        <FleetChart
          isToday={isToday}
          selectedDate={selectedDate}
          range={range}
          agents={agents}
          pendingSessionKeys={
            new Set(
              (attention?.pending ?? [])
                .map((p) => p.sessionKey)
                .filter((k): k is string => Boolean(k)),
            )
          }
        />
      </div>

      {/* Live Feed (today only) */}
      {isToday && <LiveFeed />}

      {/* Agent Rows */}
      <section data-cl-agents-anchor id="agents">
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
                style={{ color: "var(--cl-text-muted)" }}
              >
                ClawLens is watching — activity will appear here once agents start.
              </p>
            )}
          </div>
        )}

        {/* Active agent grid */}
        {activeAgents.length > 0 && (
          <div
            className="grid"
            style={{
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: 8,
            }}
          >
            {activeAgents.map((agent) => (
              <AgentRow
                key={agent.id}
                agent={agent}
                needsAttention={attentionAgentIds.has(agent.id)}
              />
            ))}
          </div>
        )}

        {/* Idle agents toggle */}
        {idleAgents.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setShowIdle((prev) => !prev)}
              className="flex items-center gap-1.5 mt-3 font-sans text-[11px] transition-colors"
              style={{
                color: "var(--cl-text-muted)",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "4px 0",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.color = "var(--cl-text-secondary)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.color = "var(--cl-text-muted)";
              }}
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  transform: showIdle ? "rotate(90deg)" : "rotate(0deg)",
                  transition: "transform 0.15s ease",
                }}
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
              {showIdle ? "Hide" : "Show"} {idleAgents.length} idle agent{idleAgents.length !== 1 ? "s" : ""}
            </button>
            {showIdle && (
              <div
                className="grid mt-2"
                style={{
                  gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                  gap: 8,
                }}
              >
                {idleAgents.map((agent) => (
                  <AgentRow
                key={agent.id}
                agent={agent}
                needsAttention={attentionAgentIds.has(agent.id)}
              />
                ))}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
