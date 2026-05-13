import { useState, useMemo, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import { useLiveApi } from "../hooks/useLiveApi";
import type { AgentInfo, AttentionResponse, RiskTier, StatsResponse } from "../lib/types";
import FleetHeader from "../components/FleetHeader";
import AttentionInbox from "../components/AttentionInbox";
import AgentRow from "../components/AgentCardCompact";
import FleetActivityChart from "../components/FleetActivityChart/FleetActivityChart";
import FleetRiskTile from "../components/FleetRiskTile/FleetRiskTile";
import LiveFeed from "../components/LiveFeed";
import ErrorCard from "../components/ErrorCard";
import DormantState from "../components/DormantState";
import { isDormant } from "../lib/homepageState";
import { isRangeOption, type RangeOption } from "../components/fleetheader/utils";
import { getPref, PREF_KEYS, setPref } from "../lib/prefs";
import { worstMeaningfulTier } from "../lib/utils";
import { shouldRefetchAttention } from "../lib/attention";

const DEFAULT_RANGE: RangeOption = "12h";

// Sort secondary key — aligns the row order with the tier pill the operator
// is reading. crit > high > med > low. (agent-grid-polish §3)
const TIER_RANK: Record<RiskTier, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

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

  // Focus is handled by `autoFocus={fullscreen}` on the minimize button in
  // FleetActivityChart — fires synchronously when that element mounts, so no
  // rAF sequencing is needed around the chart's loading/measurement branches.

  const dateParam = selectedDate ? `?date=${selectedDate}` : "";
  const isToday = selectedDate === null;

  const statsPath = useMemo(() => `api/stats${dateParam}`, [dateParam]);
  const agentsPath = useMemo(() => `api/agents${dateParam}`, [dateParam]);
  const attentionPath = useMemo(() => `api/attention${dateParam}`, [dateParam]);

  const { data: stats } = useLiveApi<StatsResponse>(statsPath);
  const { data: agents, loading, error, refetch } = useLiveApi<AgentInfo[]>(agentsPath);
  const { data: attention, refetch: refetchAttention } = useLiveApi<AttentionResponse>(
    attentionPath,
    { filter: shouldRefetchAttention },
  );
  // Issue #76: fleet-wide degraded signal — derived once at the page level
  // from the stats response so every card sees the same boolean instead of
  // re-deriving it per-card. Only "no_key" triggers the chip today; future
  // reasons would extend this.
  const llmNoKey = stats?.llmDegraded === "no_key";

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

  // Sort (agent-grid-polish §3):
  //   1. attention-flagged first (operator-action-needed signal),
  //   2. then by worst-meaningful-tier desc (aligns with the tier pill on each card),
  //   3. then by recency desc within the same tier.
  const sortedAgents = useMemo(() => {
    if (!agents) return [];
    return [...agents].sort((a, b) => {
      const aFlag = attentionAgentIds.has(a.id);
      const bFlag = attentionAgentIds.has(b.id);
      if (aFlag !== bFlag) return aFlag ? -1 : 1;
      const aTier = TIER_RANK[worstMeaningfulTier(a.todayRiskMix)];
      const bTier = TIER_RANK[worstMeaningfulTier(b.todayRiskMix)];
      if (aTier !== bTier) return bTier - aTier;
      return (b.lastActiveTimestamp ?? "").localeCompare(a.lastActiveTimestamp ?? "");
    });
  }, [agents, attentionAgentIds]);

  // First-letter collision detection across the whole rendered fleet
  // (agent-grid-polish §2(c)). When two or more agents share an initial,
  // bump them to 2-letter avatars so the visual identity holds.
  const avatarLetterCounts = useMemo(() => {
    const firstLetterCounts = new Map<string, number>();
    for (const a of sortedAgents) {
      const initial = (a.id.charAt(0) || "?").toUpperCase();
      firstLetterCounts.set(initial, (firstLetterCounts.get(initial) ?? 0) + 1);
    }
    const result = new Map<string, 1 | 2>();
    for (const a of sortedAgents) {
      const initial = (a.id.charAt(0) || "?").toUpperCase();
      result.set(a.id, (firstLetterCounts.get(initial) ?? 0) > 1 ? 2 : 1);
    }
    return result;
  }, [sortedAgents]);

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

  // Chart body is shared between inline (grid cell) and portaled (modal)
  // positions. Same element — placement flips based on chartFullscreenParam.
  // Moving between positions does remount (useApi refetches, SSE reconnects,
  // popover state resets) — accepted cost of toggling fullscreen.
  const chartAnchor = (
    <FleetActivityChart
      selectedDate={selectedDate}
      range={range}
      fullscreen={chartFullscreenParam}
      onToggleFullscreen={toggleFullscreen}
      onRangeChange={onRangeChange}
    />
  );

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
                avatarLetterCount={avatarLetterCounts.get(agent.id) ?? 1}
                llmNoKey={llmNoKey}
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
                    avatarLetterCount={avatarLetterCounts.get(agent.id) ?? 1}
                    llmNoKey={llmNoKey}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </section>

      {/* Row 1 — Fleet Activity chart, full width (homepage-bottom-row-spec §8).
          The chart stays inline here except in fullscreen mode, where the
          anchor portals out to document.body (see portal block below).
          minWidth:0 lets Grid/Flex children shrink below min-content. */}
      <section data-cl-chart-row style={{ minWidth: 0 }}>
        {!chartFullscreenParam && (
          <div data-cl-fleet-chart-anchor style={{ minWidth: 0 }}>
            {chartAnchor}
          </div>
        )}
      </section>

      {/* Row 2 — LiveFeed (2fr) + FleetRiskTile (1fr). Today-only — past-day
          views have no "risk right now" concept. Collapses to 1fr when the
          narrow-viewport breakpoint or fullscreen-chart mode applies
          (bottomRowSingleColumn handles both cases, unchanged from the old
          row). data-cl-chart-fullscreen moves here so existing listeners can
          still track the modal state from one of the anchored rows. */}
      {isToday && (
        <section
          data-cl-insights-row
          data-cl-chart-fullscreen={chartFullscreenParam ? "true" : undefined}
          style={{
            display: "grid",
            gridTemplateColumns: bottomRowSingleColumn ? "1fr" : "2fr 1fr",
            gridAutoRows: bottomRowSingleColumn ? "auto" : 464,
            gap: 12,
          }}
        >
          <div data-cl-live-feed-anchor style={{ minWidth: 0, height: "100%" }}>
            <LiveFeed />
          </div>
          <div data-cl-fleet-risk-tile-anchor style={{ minWidth: 0, height: "100%" }}>
            <FleetRiskTile />
          </div>
        </section>
      )}
      {chartFullscreenParam &&
        createPortal(
          <>
            <div
              aria-hidden="true"
              className="cl-chart-modal-backdrop"
              onClick={(e) => {
                // Guard: bubbled clicks from inside the chart must not
                // dismiss. Backdrop + modal host are siblings in the portal,
                // not nested — clicks on the chart never reach this handler
                // via bubbling, but the guard stays as defense-in-depth.
                if (e.target === e.currentTarget) toggleFullscreen();
              }}
            />
            <div
              data-cl-fleet-chart-anchor
              className="cl-chart-modal-host"
              role="dialog"
              aria-modal
              aria-label="Fleet chart (fullscreen)"
            >
              {chartAnchor}
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
