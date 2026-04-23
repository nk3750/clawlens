import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApi } from "../../hooks/useApi";
import { useSSE } from "../../hooks/useSSE";
import type {
  ActivityCategory,
  AgentInfo,
  EntryResponse,
  SessionTimelineResponse,
  TimelineSession,
} from "../../lib/types";
import { DEFAULT_AGENT_ID, deriveScheduleLabel } from "../../lib/utils";
import RangePillGroup from "../fleetheader/RangePillGroup";
import type { RangeOption } from "../fleetheader/utils";
import FleetChartRow from "./FleetChartRow";
import FleetChartTooltip from "./FleetChartTooltip";
import FleetChartDayTooltip from "./FleetChartDayTooltip";
import FleetChartClusterPopover from "./FleetChartClusterPopover";
import {
  bucketByDay,
  buildAxisTicks,
  cullLabelsForWidth,
  IDENTITY_WIDTH,
  IDENTITY_WIDTH_MOBILE,
  NOW_LABEL_GUARD_PX,
  TOTALS_WIDTH,
  TOTALS_WIDTH_MOBILE,
  VISIBLE_ROW_CAP_DESKTOP,
  VISIBLE_ROW_CAP_MOBILE,
  makeTimeToX,
  pickBreathingRingSessions,
  predictNextRun,
  reduceSSEEntry,
  surfacedChannelsForRow,
  type Cluster,
  type DayBucket,
  type SSEUpdate,
} from "./utils";

interface Props {
  isToday: boolean;
  selectedDate: string | null;
  range: RangeOption;
  /** Agent metadata from `api/agents` — already loaded on homepage. */
  agents: AgentInfo[] | null;
  /** Raw sessionKeys of attention-pending items. Used for pending crowns. */
  pendingSessionKeys: ReadonlySet<string>;
  /**
   * Stage D — fullscreen toggle state (driven by `?chart=full` URL param in
   * `Agents.tsx`). When true the chart renders as a modal overlay
   * (`.cl-chart-modal-host`) and the toggle button flips to minimize-2.
   */
  fullscreen?: boolean;
  /**
   * Layout-fixes §3 — tight is now prop-driven. Agents.tsx computes it from
   * the URL param + viewport breakpoint (`!chartFullscreenParam && !isNarrow`)
   * and passes it down. FleetChart does NOT derive it from measuredWidth
   * anymore — the modal overlay makes measuredWidth an unreliable signal.
   */
  tight: boolean;
  /** Invoked when the header maximize/minimize button is clicked. */
  onToggleFullscreen?: () => void;
  /** When provided, a `RangePillGroup` renders inside the chart header and
   *  clicks propagate to the owner. Issue #16 moved this control out of the
   *  page-level FleetHeader so range selection lives with the chart it
   *  affects. Optional so FleetChart still renders in contexts that do not
   *  host pills. */
  onRangeChange?: (range: RangeOption) => void;
}

const MOBILE_MAX_WIDTH = 640;

function localTodayIso(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dayOfWeek(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
  });
}

function dayShort(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export default function FleetChart({
  isToday,
  selectedDate,
  range,
  agents,
  pendingSessionKeys,
  fullscreen = false,
  tight,
  onToggleFullscreen,
  onRangeChange,
}: Props) {
  const navigate = useNavigate();

  const apiPath = useMemo(() => {
    const params = new URLSearchParams({ range });
    if (selectedDate) params.set("date", selectedDate);
    return `api/session-timeline?${params}`;
  }, [selectedDate, range]);

  const { data: apiData, loading, refetch } =
    useApi<SessionTimelineResponse>(apiPath);

  // Live state — seeded from REST, updated by SSE reducer (§6).
  const [liveSessions, setLiveSessions] = useState<TimelineSession[]>([]);
  const [liveAgents, setLiveAgents] = useState<string[]>([]);
  const [liveTotalActions, setLiveTotalActions] = useState(0);
  const [liveStartTime, setLiveStartTime] = useState("");
  const [liveEndTime, setLiveEndTime] = useState("");

  const [hoveredCluster, setHoveredCluster] = useState<Cluster | null>(null);
  const [hoveredDayBucket, setHoveredDayBucket] = useState<{
    bucket: DayBucket;
    agentId: string;
  } | null>(null);
  const [hoveredPos, setHoveredPos] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  const [hoveredAgent, setHoveredAgent] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [clusterPopover, setClusterPopover] = useState<{
    cluster: Cluster;
    pos: { x: number; y: number };
  } | null>(null);

  const wrapperRef = useRef<HTMLDivElement>(null);
  // Body container as STATE (not useRef) — when it first becomes non-null
  // we need the layout effect to run again so it can measure the newly-
  // attached element. A useRef would not trigger a re-run; the initial
  // loading/empty branch renders no body, so a ref-based effect would
  // capture null and never re-fire when the body appeared on a later
  // render.
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(
    null,
  );
  const [measuredWidth, setMeasuredWidth] = useState(800);

  // Seed from REST whenever the response lands. Resets SSE accretion.
  useEffect(() => {
    if (!apiData) return;
    setLiveSessions(apiData.sessions);
    setLiveAgents(apiData.agents);
    setLiveTotalActions(apiData.totalActions);
    setLiveStartTime(apiData.startTime);
    setLiveEndTime(apiData.endTime);
  }, [apiData]);

  // §7 — clear any stuck tooltip / popover when the range flips.
  useEffect(() => {
    setHoveredCluster(null);
    setHoveredDayBucket(null);
    setClusterPopover(null);
  }, [range]);

  // §6b — refetch REST on tab-return so throttled/hidden data catches up.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") refetch();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [refetch]);

  // §6a — live reducer. Route incoming entries to the most recent `#N` run.
  useSSE<EntryResponse>(
    isToday ? "api/stream" : "",
    useCallback(
      (entry: EntryResponse) => {
        if (!entry.decision) return;
        if (!isToday) return;
        const upd: SSEUpdate = {
          agentId: entry.agentId || DEFAULT_AGENT_ID,
          sessionKey: entry.sessionKey ?? "unknown",
          category: (entry.category ?? "exploring") as ActivityCategory,
          risk: entry.riskScore ?? 0,
          timestamp: entry.timestamp,
          isBlocked:
            entry.effectiveDecision === "block" ||
            entry.effectiveDecision === "denied",
        };
        setLiveSessions((prev) => reduceSSEEntry(prev, upd));
        setLiveAgents((prev) =>
          prev.includes(upd.agentId) ? prev : [...prev, upd.agentId],
        );
        setLiveTotalActions((prev) => prev + 1);
        setLiveStartTime((prev) =>
          !prev || upd.timestamp < prev ? upd.timestamp : prev,
        );
        setLiveEndTime((prev) =>
          !prev || upd.timestamp > prev ? upd.timestamp : prev,
        );
      },
      [isToday],
    ),
  );

  // Measure container width for strip layout. useLayoutEffect runs synchro-
  // nously after commit, so the post-measurement re-render lands before
  // paint — keeps the mobile/desktop branching in sync with useStripWidth
  // and avoids a flash where the layout briefly thinks it's desktop on a
  // narrow viewport. Depends on `containerEl` so it re-runs when the body
  // first attaches (the initial loading/empty branch renders no body).
  useLayoutEffect(() => {
    if (!containerEl) return;
    const update = () => {
      const rect = containerEl.getBoundingClientRect();
      setMeasuredWidth(Math.max(Math.floor(rect.width), 320));
    };
    update();
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(update)
        : null;
    if (observer) observer.observe(containerEl);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [containerEl]);

  // ── Derived data ─────────────────────────────────────────

  const nowMs = Date.now();
  // On the first render — before the REST useEffect has seeded
  // `liveStartTime` — fall back to `nowMs - rangeSpanMs(range)` so the axis
  // math spans a sensible window. Using 0 here is catastrophic: with an
  // epoch-based startMs and a NOW-based endMs, `buildAxisTicks` iterates
  // ~2M times creating DOM nodes and blows the heap before the effect's
  // re-render arrives. (Scheduled agents trigger this because
  // `hasScheduledAgents` bypasses the empty-state early return that otherwise
  // masks the same issue for interactive-only fleets.)
  const startMs = liveStartTime
    ? new Date(liveStartTime).getTime()
    : nowMs - rangeSpanMs(range);
  // Axis extension for ghost markers (§2f). `endMs` defaults to NOW on today,
  // but that makes `ghostNextRunMs > nowMs && ghostNextRunMs <= endMs`
  // contradictory — ghosts never render. When a scheduled agent has a stable
  // cadence we nudge endMs forward just enough to fit the soonest predicted
  // run, capped at 15% of the range span so a mis-inferred far-future run
  // doesn't balloon the axis. 12h/24h hide ghosts per §2f so we skip there.
  const endMs = useMemo(() => {
    if (!isToday) {
      return liveEndTime ? new Date(liveEndTime).getTime() : nowMs;
    }
    if (range !== "1h" && range !== "3h" && range !== "6h") return nowMs;
    let latestGhost = 0;
    for (const a of agents ?? []) {
      if (a.mode !== "scheduled") continue;
      const ghost = predictNextRun(a.id, liveSessions, nowMs);
      if (ghost !== null && ghost > latestGhost) latestGhost = ghost;
    }
    if (latestGhost <= nowMs) return nowMs;
    const cap = nowMs + rangeSpanMs(range) * 0.15;
    return Math.min(latestGhost, cap);
  }, [isToday, liveEndTime, range, agents, liveSessions, nowMs]);

  const mobile = measuredWidth < MOBILE_MAX_WIDTH;
  const identityW = mobile ? IDENTITY_WIDTH_MOBILE : IDENTITY_WIDTH;
  const totalsW = mobile ? TOTALS_WIDTH_MOBILE : TOTALS_WIDTH;
  const stripWidth = Math.max(measuredWidth - identityW - totalsW, 100);

  const agentInfoById = useMemo(() => {
    const map = new Map<string, AgentInfo>();
    for (const a of agents ?? []) map.set(a.id, a);
    return map;
  }, [agents]);

  const agentNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of agents ?? []) map.set(a.id, a.name);
    for (const id of liveAgents) if (!map.has(id)) map.set(id, id);
    return map;
  }, [agents, liveAgents]);

  // Merge the session-derived agent list with the known-agents list so idle
  // agents don't drop from the view (§4d).
  const allAgentIds = useMemo(() => {
    const ids = new Set<string>(liveAgents);
    for (const a of agents ?? []) ids.add(a.id);
    return [...ids];
  }, [agents, liveAgents]);

  const sessionsByAgent = useMemo(() => {
    const map = new Map<string, TimelineSession[]>();
    for (const s of liveSessions) {
      const list = map.get(s.agentId);
      if (list) list.push(s);
      else map.set(s.agentId, [s]);
    }
    return map;
  }, [liveSessions]);

  const sortedAgents = useMemo(() => {
    const totals = new Map<string, number>();
    for (const s of liveSessions) {
      totals.set(s.agentId, (totals.get(s.agentId) ?? 0) + s.actionCount);
    }
    const withInfo: {
      id: string;
      info: AgentInfo;
      total: number;
      isIdle: boolean;
      scheduleLabel: string | null;
      channels: ReturnType<typeof surfacedChannelsForRow>;
      hasScheduleOrChannel: boolean;
      lastActiveMs: number;
    }[] = [];
    for (const id of allAgentIds) {
      const info = agentInfoById.get(id) ?? fallbackAgent(id);
      const total = totals.get(id) ?? 0;
      const scheduleLabel = deriveScheduleLabel(
        info.mode,
        cronStartsForAgent(id, liveSessions),
        info.schedule,
      );
      const channels = surfacedChannelsForRow(id, liveSessions);
      // §3 — drop rows that carry no signal in this window: zero actions, no
      // surfaced channel, no usable schedule label, no attention flag. These
      // belong in the agents-grid roster, not in the chart.
      const dormant =
        total === 0 &&
        channels.length === 0 &&
        scheduleLabel === null &&
        !info.needsAttention;
      if (dormant) continue;
      const lastActiveMs = info.lastActiveTimestamp
        ? new Date(info.lastActiveTimestamp).getTime()
        : 0;
      withInfo.push({
        id,
        info,
        total,
        isIdle: total === 0,
        scheduleLabel,
        channels,
        hasScheduleOrChannel: scheduleLabel !== null || channels.length > 0,
        lastActiveMs,
      });
    }
    // §4 ranking: needs-attention first, then total desc, then
    // scheduled/channel-tagged before plain idle, then most-recently-active,
    // then stable by id. Step 4 of the polish pass replaces the active/idle
    // split with a single ranked list — this ranking already lives here so
    // that step is a one-line change.
    withInfo.sort((a, b) => {
      if (a.info.needsAttention !== b.info.needsAttention) {
        return a.info.needsAttention ? -1 : 1;
      }
      if (a.total !== b.total) return b.total - a.total;
      if (a.hasScheduleOrChannel !== b.hasScheduleOrChannel) {
        return a.hasScheduleOrChannel ? -1 : 1;
      }
      if (a.lastActiveMs !== b.lastActiveMs) {
        return b.lastActiveMs - a.lastActiveMs;
      }
      return a.id.localeCompare(b.id);
    });
    return withInfo;
  }, [allAgentIds, agentInfoById, liveSessions]);

  // §4 — unified ranked list capped at VISIBLE_ROW_CAP_*. Hidden rows live
  // behind one expander button. Needs-attention agents bypass the cap (they
  // ride along even when ranking would push them below it) — see §4 spec.
  const visibleCap = mobile ? VISIBLE_ROW_CAP_MOBILE : VISIBLE_ROW_CAP_DESKTOP;
  const attentionRows = sortedAgents.filter((r) => r.info.needsAttention);
  const regularRows = sortedAgents.filter((r) => !r.info.needsAttention);
  const regularSlot = Math.max(0, visibleCap - attentionRows.length);
  const visibleRows = [
    ...attentionRows,
    ...regularRows.slice(0, regularSlot),
  ];
  const hiddenRows = regularRows.slice(regularSlot);
  // The NOW cap rides on the first rendered strip so it inherits the
  // strip's measured width. When the expander is collapsed but visibleRows
  // is empty (e.g., every non-dormant agent is hidden — pathological), the
  // first hidden row still anchors the cap so it doesn't disappear.
  const firstRenderedAgentId =
    visibleRows[0]?.id ?? hiddenRows[0]?.id ?? null;

  const dayBuckets = useMemo(
    () => bucketByDay(allAgentIds, liveSessions, nowMs),
    [allAgentIds, liveSessions, nowMs],
  );
  const maxDayActions = useMemo(() => {
    let max = 0;
    for (const buckets of dayBuckets.values()) {
      for (const b of buckets) if (b.actions > max) max = b.actions;
    }
    return max;
  }, [dayBuckets]);
  const todayIso = localTodayIso(nowMs);

  const breathingRingKeys = useMemo(
    () => pickBreathingRingSessions(liveSessions, range),
    [liveSessions, range],
  );

  const timeToX = useMemo(
    () => makeTimeToX(startMs, endMs, stripWidth),
    [startMs, endMs, stripWidth],
  );
  const axisTicks = useMemo(
    () => (range === "7d" ? [] : buildAxisTicks(startMs, endMs, range)),
    [range, startMs, endMs],
  );
  const labelShown = useMemo(
    () => cullLabelsForWidth(axisTicks, timeToX),
    [axisTicks, timeToX],
  );

  const totalActions = isToday ? liveTotalActions : apiData?.totalActions ?? 0;

  // NOW cap (▼ + NOW label) is rendered INSIDE the first row's strip so it
  // anchors against the strip's own measured width (which is what drives the
  // per-row NOW line). Attaching it to the parent body's measurement would
  // desync against the actual strip render width — see bug #1.
  const showNowCap = isToday && range !== "7d";

  // §2 — drop axis labels within NOW_LABEL_GUARD_PX of the NOW marker so the
  // hour-tick text doesn't visually stack on the ▼ NOW cap. The tick LINE
  // still draws; only the text is suppressed (filter happens after the
  // existing density cull).
  const labelShownFinal = useMemo(() => {
    if (!showNowCap) return labelShown;
    const nowX = timeToX(nowMs);
    const kept = new Set<number>();
    for (const ms of labelShown) {
      const tx = timeToX(ms);
      if (Math.abs(tx - nowX) >= NOW_LABEL_GUARD_PX) kept.add(ms);
    }
    return kept;
  }, [labelShown, showNowCap, timeToX, nowMs]);

  // ── Handlers ─────────────────────────────────────────────

  const handleHoverCluster = useCallback(
    (c: Cluster | null, event: React.MouseEvent<SVGGElement> | null) => {
      setHoveredDayBucket(null);
      setHoveredCluster(c);
      if (c && event && wrapperRef.current) {
        const rect = wrapperRef.current.getBoundingClientRect();
        setHoveredPos({
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        });
      }
    },
    [],
  );

  const handleClickCluster = useCallback(
    (c: Cluster, event: React.MouseEvent<SVGGElement>) => {
      // Single-session "cluster" (N=1) behaves as a direct-navigate per spec;
      // real clusters open a popover listing their constituent sessions.
      if (!c.isCluster) {
        navigate(
          `/session/${encodeURIComponent(c.sessions[0].sessionKey)}`,
        );
        return;
      }
      let pos = { x: 0, y: 0 };
      if (wrapperRef.current) {
        const rect = wrapperRef.current.getBoundingClientRect();
        pos = {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        };
      }
      setHoveredCluster(null);
      setClusterPopover({ cluster: c, pos });
    },
    [navigate],
  );

  const handleHoverDay = useCallback(
    (
      bucket: DayBucket | null,
      agentId: string,
      event: React.MouseEvent<SVGGElement> | null,
    ) => {
      setHoveredCluster(null);
      if (bucket) setHoveredDayBucket({ bucket, agentId });
      else setHoveredDayBucket(null);
      if (bucket && event && wrapperRef.current) {
        const rect = wrapperRef.current.getBoundingClientRect();
        setHoveredPos({
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        });
      }
    },
    [],
  );

  const handleClickDay = useCallback(
    (bucket: DayBucket, _agentId: string) => {
      navigate(`/?date=${bucket.iso}`);
    },
    [navigate],
  );

  // ── Render ────────────────────────────────────────────────

  if (loading && !apiData) {
    return (
      <div>
        <span className="label-mono" style={{ color: "var(--cl-text-muted)" }}>
          FLEET ACTIVITY
        </span>
        <p
          className="text-sm py-8 text-center"
          style={{ color: "var(--cl-text-muted)" }}
        >
          Loading...
        </p>
      </div>
    );
  }

  const hasScheduledAgents = sortedAgents.some(
    (r) => r.info.mode === "scheduled",
  );
  const chartIsEmpty =
    totalActions === 0 && !hasScheduledAgents && liveAgents.length === 0;

  if (chartIsEmpty) {
    return (
      <div>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <span
            className="font-display text-sm font-medium"
            style={{ color: "var(--cl-text-secondary)" }}
          >
            Fleet Activity
          </span>
        </div>
        <p
          className="text-sm py-8 text-center"
          style={{ color: "var(--cl-text-muted)" }}
        >
          {isToday
            ? emptyMessage(range)
            : "No activity on this day"}
        </p>
        <div className="text-center">
          <Link
            to="/activity"
            className="text-xs"
            style={{ color: "var(--cl-text-muted)" }}
          >
            View all activity &rarr;
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={wrapperRef}
      style={{ position: "relative" }}
      data-cl-fleet-chart
    >
      {/* Header — title + range pills + fullscreen toggle. flex-wrap lets
          pills reflow below the title in the middle viewport band without
          pushing the toggle off-screen; marginLeft: auto on the toggle keeps
          it right-aligned whether it lands in row 1 or wraps to row 2. */}
      <div
        className="flex items-center mb-3"
        style={{ gap: 8, flexWrap: "wrap" }}
      >
        <span
          className="font-display text-sm font-medium"
          style={{ color: "var(--cl-text-secondary)" }}
        >
          Fleet Activity
        </span>
        {onRangeChange && (
          <RangePillGroup value={range} onChange={onRangeChange} />
        )}
        {onToggleFullscreen && (
          <button
            type="button"
            onClick={onToggleFullscreen}
            className="cl-btn-subtle"
            style={{ height: 24, padding: "0 8px", marginLeft: "auto" }}
            aria-label={fullscreen ? "Exit fullscreen" : "Expand fleet chart"}
            data-cl-chart-fullscreen-toggle
            // biome-ignore lint/a11y/noAutofocus: modal dialog pattern — on
            //   fullscreen open the minimize button is the natural keyboard
            //   exit, and autoFocus naturally sequences around FleetChart's
            //   loading/measurement re-renders (fires when THIS specific
            //   element mounts, not when the chart first renders).
            autoFocus={fullscreen}
          >
            {fullscreen ? (
              // Lucide minimize-2 — two inward arrows.
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="4 14 10 14 10 20" />
                <polyline points="20 10 14 10 14 4" />
                <line x1="14" y1="10" x2="21" y2="3" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            ) : (
              // Lucide maximize-2 — two outward arrows.
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="15 3 21 3 21 9" />
                <polyline points="9 21 3 21 3 15" />
                <line x1="21" y1="3" x2="14" y2="10" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            )}
          </button>
        )}
      </div>

      {/* Chart body */}
      <div
        ref={setContainerEl}
        data-cl-fleet-body
        data-cl-fleet-hovered={hoveredAgent ?? undefined}
        style={{ position: "relative" }}
      >
        {/* 7d column headers — rendered above rows */}
        {range === "7d" &&
          (() => {
            const sampleBuckets = dayBuckets.get(allAgentIds[0]) ?? [];
            if (sampleBuckets.length === 0) return null;
            return (
              <div
                className="flex items-end"
                style={{ height: 32, marginBottom: 4 }}
              >
                <div style={{ width: identityW }} />
                <div
                  className="flex-1 min-w-0 flex items-end"
                  style={{ marginLeft: 0 }}
                >
                  {sampleBuckets.map((b) => {
                    const isToday2 = b.iso === todayIso;
                    return (
                      <div
                        key={b.iso}
                        className="flex flex-col items-center label-mono"
                        style={{
                          flex: "1 1 0",
                          fontSize: 10,
                          color: isToday2
                            ? "var(--cl-accent)"
                            : "var(--cl-text-muted)",
                        }}
                        data-cl-fleet-day-header={b.iso}
                      >
                        <span>{dayOfWeek(b.iso)}</span>
                        <span style={{ opacity: 0.7 }}>{dayShort(b.iso)}</span>
                      </div>
                    );
                  })}
                </div>
                <div style={{ width: totalsW }} />
              </div>
            );
          })()}

        {/* Visible rows (top-N from the ranked list, including any
            needs-attention agents that bypass the cap) */}
        {visibleRows.map((r) => (
          <FleetChartRow
            key={r.id}
            agent={r.info}
            range={range}
            isToday={isToday}
            mobile={mobile}
            sessions={sessionsByAgent.get(r.id) ?? []}
            scheduleLabel={r.scheduleLabel}
            channels={r.channels}
            pendingSessionKeys={pendingSessionKeys}
            breathingRingKeys={breathingRingKeys}
            ghostNextRunMs={
              r.info.mode === "scheduled"
                ? predictNextRun(r.id, liveSessions, nowMs)
                : null
            }
            startMs={startMs}
            endMs={endMs}
            nowMs={nowMs}
            days={dayBuckets.get(r.id) ?? []}
            maxDayActions={maxDayActions}
            todayIso={todayIso}
            isDimmed={hoveredAgent !== null && hoveredAgent !== r.id}
            showNowCap={showNowCap && r.id === firstRenderedAgentId}
            tight={tight}
            onHoverRow={setHoveredAgent}
            onHoverCluster={handleHoverCluster}
            onClickCluster={handleClickCluster}
            onHoverDay={handleHoverDay}
            onClickDay={handleClickDay}
          />
        ))}

        {/* Unified expander — one button collapses everything below the cap.
            `data-cl-fleet-idle-toggle` retained for back-compat with existing
            Playwright + unit tests; new tests should target the
            `data-cl-fleet-more-toggle` selector. */}
        {hiddenRows.length > 0 && (
          <button
            type="button"
            onClick={() => setShowHidden((v) => !v)}
            className="label-mono flex items-center gap-1 mt-2"
            style={{
              fontSize: 10,
              color: "var(--cl-text-muted)",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "4px 0",
            }}
            data-cl-fleet-idle-toggle
            data-cl-fleet-more-toggle
          >
            {showHidden ? "Hide" : `Show ${hiddenRows.length} more agent${hiddenRows.length === 1 ? "" : "s"}`}
            {showHidden ? " \u25B4" : " \u25BE"}
          </button>
        )}

        {showHidden &&
          hiddenRows.map((r) => (
            <FleetChartRow
              key={r.id}
              agent={r.info}
              range={range}
              isToday={isToday}
              mobile={mobile}
              sessions={sessionsByAgent.get(r.id) ?? []}
              scheduleLabel={r.scheduleLabel}
              channels={r.channels}
              pendingSessionKeys={pendingSessionKeys}
              breathingRingKeys={breathingRingKeys}
              ghostNextRunMs={
                r.info.mode === "scheduled"
                  ? predictNextRun(r.id, liveSessions, nowMs)
                  : null
              }
              startMs={startMs}
              endMs={endMs}
              nowMs={nowMs}
              days={dayBuckets.get(r.id) ?? []}
              maxDayActions={maxDayActions}
              todayIso={todayIso}
              isDimmed={hoveredAgent !== null && hoveredAgent !== r.id}
              showNowCap={showNowCap && r.id === firstRenderedAgentId}
              tight={tight}
              onHoverRow={setHoveredAgent}
              onHoverCluster={handleHoverCluster}
              onClickCluster={handleClickCluster}
              onHoverDay={handleHoverDay}
              onClickDay={handleClickDay}
            />
          ))}

        {/* Hour-tick axis (not 7d) */}
        {range !== "7d" && stripWidth > 0 && (
          <div
            className="flex"
            style={{ marginTop: 4, height: 16 }}
            data-cl-fleet-axis
          >
            <div style={{ width: identityW }} />
            <div className="flex-1 relative" style={{ height: 16 }}>
              <svg
                viewBox={`0 0 ${stripWidth} 16`}
                width="100%"
                height={16}
                preserveAspectRatio="none"
                style={{ display: "block" }}
              >
                <line
                  x1={0}
                  x2={stripWidth}
                  y1={0.5}
                  y2={0.5}
                  stroke="var(--cl-border-subtle)"
                  strokeWidth={0.5}
                />
                {axisTicks.map((t) => {
                  const tx = timeToX(t.ms);
                  if (tx < 0 || tx > stripWidth) return null;
                  return (
                    <g key={t.ms}>
                      <line
                        x1={tx}
                        x2={tx}
                        y1={0}
                        y2={3}
                        stroke="var(--cl-text-muted)"
                        strokeWidth={0.5}
                      />
                      {labelShownFinal.has(t.ms) && (
                        <text
                          x={tx}
                          y={13}
                          textAnchor="middle"
                          className="label-mono"
                          style={{
                            fill: "var(--cl-text-muted)",
                            fontSize: 10,
                          }}
                        >
                          {t.label}
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>
            </div>
            <div style={{ width: totalsW }} />
          </div>
        )}
      </div>

      {/* Tooltips (suppressed while the cluster popover is open so we don't
          double up a tooltip + popover for the same dot). */}
      {hoveredCluster && !clusterPopover && (
        <FleetChartTooltip
          cluster={hoveredCluster}
          pos={hoveredPos}
          wrapperRef={wrapperRef}
          pendingSessionKeys={pendingSessionKeys}
          agentNameById={agentNameById}
        />
      )}
      {hoveredDayBucket && (
        <FleetChartDayTooltip
          bucket={hoveredDayBucket.bucket}
          agentId={hoveredDayBucket.agentId}
          agentName={
            agentNameById.get(hoveredDayBucket.agentId) ??
            hoveredDayBucket.agentId
          }
          pos={hoveredPos}
          wrapperRef={wrapperRef}
        />
      )}
      {clusterPopover && (
        <FleetChartClusterPopover
          cluster={clusterPopover.cluster}
          pos={clusterPopover.pos}
          wrapperRef={wrapperRef}
          agentName={
            agentNameById.get(clusterPopover.cluster.sessions[0].agentId) ??
            clusterPopover.cluster.sessions[0].agentId
          }
          onClose={() => setClusterPopover(null)}
        />
      )}
    </div>
  );
}

function emptyMessage(range: RangeOption): string {
  switch (range) {
    case "1h":
      return "No agent activity in the last hour";
    case "3h":
      return "No agent activity in the last 3 hours";
    case "6h":
      return "No agent activity in the last 6 hours";
    case "12h":
      return "No agent activity in the last 12 hours";
    case "24h":
      return "No agent activity in the last 24 hours";
    case "7d":
      return "No agent activity in the last 7 days";
  }
}

const HOUR_MS = 3_600_000;
function rangeSpanMs(range: RangeOption): number {
  switch (range) {
    case "1h":
      return HOUR_MS;
    case "3h":
      return 3 * HOUR_MS;
    case "6h":
      return 6 * HOUR_MS;
    case "12h":
      return 12 * HOUR_MS;
    case "24h":
      return 24 * HOUR_MS;
    case "7d":
      return 7 * 24 * HOUR_MS;
  }
}

function fallbackAgent(id: string): AgentInfo {
  return {
    id,
    name: id,
    status: "active",
    todayToolCalls: 0,
    avgRiskScore: 0,
    peakRiskScore: 0,
    lastActiveTimestamp: null,
    mode: "interactive",
    riskPosture: "calm",
    activityBreakdown: {
      exploring: 0,
      changes: 0,
      git: 0,
      scripts: 0,
      web: 0,
      comms: 0,
    },
    todayActivityBreakdown: {
      exploring: 0,
      changes: 0,
      git: 0,
      scripts: 0,
      web: 0,
      comms: 0,
    },
    needsAttention: false,
    blockedCount: 0,
    riskProfile: { low: 0, medium: 0, high: 0, critical: 0 },
    todayRiskMix: { low: 0, medium: 0, high: 0, critical: 0 },
    hourlyActivity: Array.from({ length: 24 }, () => 0),
  };
}

function cronStartsForAgent(
  agentId: string,
  sessions: TimelineSession[],
): string[] {
  const out: string[] = [];
  for (const s of sessions) {
    if (s.agentId !== agentId) continue;
    // parts[2] may carry a split-session `#N` suffix when the sessionKey has
    // no subPath (e.g. "agent:a1:cron#2"). Strip before comparing.
    const parts = s.sessionKey.split(":");
    const channel = (parts[2] ?? "").replace(/#\d+$/, "");
    if (channel === "cron") out.push(s.startTime);
  }
  return out;
}
