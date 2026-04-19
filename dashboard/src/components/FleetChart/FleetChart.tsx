import {
  useCallback,
  useEffect,
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
import type { RangeOption } from "../fleetheader/utils";
import FleetChartRow from "./FleetChartRow";
import FleetChartTooltip from "./FleetChartTooltip";
import FleetChartDayTooltip from "./FleetChartDayTooltip";
import FleetChartClusterPopover from "./FleetChartClusterPopover";
import {
  bucketByDay,
  buildAxisTicks,
  channelsForAgent,
  cullLabelsForWidth,
  IDENTITY_WIDTH,
  IDENTITY_WIDTH_MOBILE,
  TOTALS_WIDTH,
  TOTALS_WIDTH_MOBILE,
  makeTimeToX,
  pickBreathingRingSessions,
  predictNextRun,
  reduceSSEEntry,
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
}

const IDLE_COLLAPSE_THRESHOLD = 5;
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
  const [showIdle, setShowIdle] = useState(false);
  const [clusterPopover, setClusterPopover] = useState<{
    cluster: Cluster;
    pos: { x: number; y: number };
  } | null>(null);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
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

  // Measure container width for strip layout.
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setMeasuredWidth(Math.max(Math.floor(rect.width), 320));
    };
    update();
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(update)
        : null;
    if (observer) observer.observe(el);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  // ── Derived data ─────────────────────────────────────────

  const nowMs = Date.now();
  const startMs = liveStartTime ? new Date(liveStartTime).getTime() : 0;
  const endMs = isToday
    ? nowMs
    : liveEndTime
      ? new Date(liveEndTime).getTime()
      : nowMs;

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
    }[] = [];
    for (const id of allAgentIds) {
      const info = agentInfoById.get(id) ?? fallbackAgent(id);
      const total = totals.get(id) ?? 0;
      const isIdle = total === 0;
      withInfo.push({ id, info, total, isIdle });
    }
    withInfo.sort((a, b) => {
      if (a.isIdle !== b.isIdle) return a.isIdle ? 1 : -1;
      return b.total - a.total;
    });
    return withInfo;
  }, [allAgentIds, agentInfoById, liveSessions]);

  const activeRows = sortedAgents.filter((r) => !r.isIdle);
  const idleRows = sortedAgents.filter((r) => r.isIdle);
  const shouldCollapseIdle = idleRows.length > IDLE_COLLAPSE_THRESHOLD;
  const visibleIdleRows = shouldCollapseIdle && !showIdle ? [] : idleRows;

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

  // NOW cap position (▼ + NOW label above the strips) — only when today &
  // on a non-day-grid range. The cap sits above the first row; the per-row
  // NOW line continues the visual through each strip.
  const nowCapLeft =
    isToday && range !== "7d" && stripWidth > 0
      ? identityW + timeToX(nowMs)
      : null;
  const nowCapVisible =
    nowCapLeft !== null &&
    timeToX(nowMs) >= 0 &&
    timeToX(nowMs) <= stripWidth;

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
      {/* Header */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <span
          className="font-display text-sm font-medium"
          style={{ color: "var(--cl-text-secondary)" }}
        >
          Fleet Activity
        </span>
        <span
          className="flex items-center gap-3 label-mono"
          style={{ fontSize: 10, color: "var(--cl-text-muted)" }}
        >
          <span className="flex items-center gap-1">
            <span
              className="inline-block rounded-full"
              style={{
                width: 7,
                height: 7,
                border: "1.5px solid var(--cl-text-secondary)",
              }}
            />
            attention
          </span>
          <span className="flex items-center gap-1">
            <span
              className="inline-block rounded-full"
              style={{
                width: 4,
                height: 4,
                backgroundColor: "var(--cl-text-secondary)",
              }}
            />
            routine
          </span>
          {range !== "7d" && range !== "12h" && range !== "24h" && (
            <span className="flex items-center gap-1">
              <span style={{ color: "var(--cl-text-muted)" }}>⌇</span>
              scheduled
            </span>
          )}
        </span>
      </div>

      {/* Chart body */}
      <div
        ref={containerRef}
        data-cl-fleet-body
        data-cl-fleet-hovered={hoveredAgent ?? undefined}
        style={{ position: "relative" }}
      >
        {/* NOW cap — ▼ triangle + "NOW" text above the first row, aligned
            horizontally with the per-row vertical NOW line. */}
        {nowCapVisible && nowCapLeft !== null && (
          <div
            data-cl-fleet-now-cap
            style={{
              position: "absolute",
              top: -6,
              left: nowCapLeft,
              transform: "translateX(-50%)",
              pointerEvents: "none",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              zIndex: 5,
            }}
          >
            <span
              className="label-mono"
              style={{
                color: "var(--cl-accent)",
                fontSize: 9,
                lineHeight: 1,
                animation: "pulse 2s ease-in-out infinite",
              }}
            >
              NOW
            </span>
            <span
              style={{
                color: "var(--cl-accent)",
                fontSize: 9,
                lineHeight: 1,
                marginTop: 1,
              }}
            >
              ▼
            </span>
          </div>
        )}
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

        {/* Active rows */}
        {activeRows.map((r) => (
          <FleetChartRow
            key={r.id}
            agent={r.info}
            range={range}
            isToday={isToday}
            mobile={mobile}
            sessions={sessionsByAgent.get(r.id) ?? []}
            scheduleLabel={deriveScheduleLabel(
              r.info.mode,
              cronStartsForAgent(r.id, liveSessions),
              r.info.schedule,
            )}
            channels={channelsForAgent(r.id, liveSessions)}
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
            onHoverRow={setHoveredAgent}
            onHoverCluster={handleHoverCluster}
            onClickCluster={handleClickCluster}
            onHoverDay={handleHoverDay}
            onClickDay={handleClickDay}
          />
        ))}

        {/* Idle rows (collapsible) */}
        {idleRows.length > 0 && shouldCollapseIdle && (
          <button
            type="button"
            onClick={() => setShowIdle((v) => !v)}
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
          >
            {showIdle ? "Hide" : "Show"} {idleRows.length} idle agent
            {idleRows.length !== 1 ? "s" : ""}
          </button>
        )}
        {visibleIdleRows.map((r) => (
          <FleetChartRow
            key={r.id}
            agent={r.info}
            range={range}
            isToday={isToday}
            mobile={mobile}
            sessions={sessionsByAgent.get(r.id) ?? []}
            scheduleLabel={deriveScheduleLabel(
              r.info.mode,
              cronStartsForAgent(r.id, liveSessions),
              r.info.schedule,
            )}
            channels={channelsForAgent(r.id, liveSessions)}
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
                      {labelShown.has(t.ms) && (
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
      commands: 0,
      web: 0,
      comms: 0,
      data: 0,
    },
    todayActivityBreakdown: {
      exploring: 0,
      changes: 0,
      commands: 0,
      web: 0,
      comms: 0,
      data: 0,
    },
    needsAttention: false,
    blockedCount: 0,
    riskProfile: { low: 0, medium: 0, high: 0, critical: 0 },
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
