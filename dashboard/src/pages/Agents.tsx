import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useLiveApi } from "../hooks/useLiveApi";
import type { AgentInfo, AttentionResponse, StatsResponse } from "../lib/types";
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

/** Narrow viewports force single-column layout regardless of the `?chart=full`
 *  param — the chart already gets the full row width there, and the LiveFeed
 *  stacks below. 911px matches the 520 + 380 + 12-gap minimum of the weighted
 *  2fr/1fr split (layout-fixes §1); below that the split would overflow so we
 *  stack instead. */
const NARROW_BREAKPOINT_QUERY = "(max-width: 911px)";

function useIsNarrowViewport(): boolean {
  const [isNarrow, setIsNarrow] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(NARROW_BREAKPOINT_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(NARROW_BREAKPOINT_QUERY);
    const onChange = (e: MediaQueryListEvent) => setIsNarrow(e.matches);
    // Initial sync in case the state closure missed a resize during mount.
    setIsNarrow(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isNarrow;
}

export default function Agents() {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [range, setRangeState] = useState<RangeOption>(readInitialRange);
  const [showIdle, setShowIdle] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const isNarrow = useIsNarrowViewport();
  const chartFullscreenParam = searchParams.get("chart") === "full";
  // Narrow viewports override the URL param — spec §D1.
  const bottomRowSingleColumn = chartFullscreenParam || isNarrow;
  const toggleFullscreen = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (next.get("chart") === "full") next.delete("chart");
        else next.set("chart", "full");
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);
  const chartAnchorRef = useRef<HTMLDivElement>(null);

  // Esc-to-close while the modal is open. Listener lives on window because
  // React's synthetic event system won't fire keydown on unfocused elements.
  useEffect(() => {
    if (!chartFullscreenParam) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") toggleFullscreen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chartFullscreenParam, toggleFullscreen]);

  // Body scroll-lock while the modal is open. Save the prior value so
  // downstream code that tweaked body overflow keeps working after close.
  useEffect(() => {
    if (!chartFullscreenParam) return;
    const prior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prior;
    };
  }, [chartFullscreenParam]);

  // Focus the minimize button when the modal opens — gives keyboard users a
  // clear exit and matches the modal-dialog affordance. The button already
  // renders with data-cl-chart-fullscreen-toggle; we query it off the anchor
  // rather than drilling a ref through FleetChart. Defer one frame so
  // FleetChart's own measurement-driven re-renders can't snatch focus back
  // to body before our effect lands.
  useEffect(() => {
    if (!chartFullscreenParam) return;
    const handle = requestAnimationFrame(() => {
      const btn = chartAnchorRef.current?.querySelector<HTMLButtonElement>(
        "[data-cl-chart-fullscreen-toggle]",
      );
      btn?.focus();
    });
    return () => cancelAnimationFrame(handle);
  }, [chartFullscreenParam]);

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

  const pendingCount = attention?.pending.length ?? 0;
  const pendingAgentNames = useMemo(
    () => (attention?.pending ?? []).map((p) => p.agentName),
    [attention],
  );

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
          pendingCount={pendingCount}
          pendingAgentNames={pendingAgentNames}
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

      {/* Agent Rows — promoted above the fleet chart in Stage C */}
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
              gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
              gap: 10,
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
              className="flex items-center gap-1.5 mt-3"
              style={{
                color: "var(--cl-text-muted)",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "4px 0",
                fontFamily: "var(--cl-font-sans)",
                fontSize: 11,
                fontWeight: 510,
                transition: "color var(--cl-dur-fast) var(--cl-ease)",
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
                  transition: "transform var(--cl-dur-fast) var(--cl-ease)",
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
                  gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
                  gap: 10,
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

      {/* Backdrop sibling — only rendered while the modal is open. Sits
          above the bottom-row grid in DOM order so a click on it while the
          chart is fixed-positioned above still reads e.target===e.currentTarget
          correctly (guard below). */}
      {chartFullscreenParam && (
        <div
          aria-hidden="true"
          className="cl-chart-modal-backdrop"
          onClick={(e) => {
            // Guard: bubbled clicks from inside the chart (cluster popover,
            // tooltip drags, button releases) must not dismiss. Pattern
            // matches GuardrailModal.
            if (e.target === e.currentTarget) toggleFullscreen();
          }}
        />
      )}

      {/* Bottom row — Fleet Chart + Live Feed side-by-side (spec §D1,
          layout-fixes §1).
          - default: weighted 2fr/1fr split with min-widths (520/380)
          - ?chart=full: modal overlay (cl-chart-modal-host on the anchor)
            with the grid collapsed to 1fr so the feed fills the row behind
          - narrow viewports (<= 911px): single column regardless of param
          - minWidth:0 on both anchors so Grid can shrink them below their
            content's min-content (fr math needs this). */}
      <section
        data-cl-bottom-row
        data-cl-chart-fullscreen={chartFullscreenParam ? "true" : undefined}
        style={{
          display: "grid",
          gridTemplateColumns: bottomRowSingleColumn
            ? "1fr"
            : "minmax(520px, 2fr) minmax(380px, 1fr)",
          gap: 12,
        }}
      >
        <div
          ref={chartAnchorRef}
          data-cl-fleet-chart-anchor
          className={chartFullscreenParam ? "cl-chart-modal-host" : undefined}
          role={chartFullscreenParam ? "dialog" : undefined}
          aria-modal={chartFullscreenParam ? true : undefined}
          aria-label={
            chartFullscreenParam ? "Fleet chart (fullscreen)" : undefined
          }
          style={{ minWidth: 0 }}
        >
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
            fullscreen={chartFullscreenParam}
            tight={!chartFullscreenParam && !isNarrow}
            onToggleFullscreen={toggleFullscreen}
          />
        </div>
        {isToday && (
          <div data-cl-live-feed-anchor style={{ minWidth: 0 }}>
            <LiveFeed />
          </div>
        )}
      </section>
    </div>
  );
}
