import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { useApi } from "../../hooks/useApi";
import { useReducedMotion } from "../../hooks/useReducedMotion";
import { useSSE } from "../../hooks/useSSE";
import type {
  ActivityCategory,
  EntryResponse,
  FleetActivityResponse,
  RiskTier,
} from "../../lib/types";
import { CATEGORY_META } from "../../lib/utils";
import RangePillGroup from "../fleetheader/RangePillGroup";
import type { RangeOption } from "../fleetheader/utils";
import SwarmPopover from "./SwarmPopover";
import {
  CLUSTER_PX,
  LANE_ORDER,
  type SwarmCluster,
  type SwarmDot,
  buildDayTicks,
  buildHourTicks,
  clusterDots,
  cullLabelsForWidth,
  haloRadiusOffset,
  jitterForKey,
  laneHeight,
  laneYForCategory,
  makeTimeToX,
} from "./utils";
import "./FleetActivityChart.css";

interface Props {
  range: RangeOption;
  selectedDate: string | null;
  onRangeChange?: (next: RangeOption) => void;
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

const INLINE_CHART_HEIGHT = 132;
const FULLSCREEN_CHART_HEIGHT = 360;
const DOT_RADIUS = 4;
const CLUSTER_RADIUS = 5;
const LIVE_CAP = 5000;
const LEFT_EDGE_FADE_PCT = 0.05;
const ENTER_ANIMATION_MS = 280;
const BURST_WINDOW_MS = 1000;
const BURST_THRESHOLD = 10;

export default function FleetActivityChart({
  range,
  selectedDate,
  onRangeChange,
  fullscreen = false,
  onToggleFullscreen,
}: Props) {
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();
  const isToday = selectedDate === null;

  const apiPath = useMemo(() => {
    const params = new URLSearchParams({ range });
    if (selectedDate) params.set("date", selectedDate);
    return `api/fleet-activity?${params}`;
  }, [range, selectedDate]);

  const { data, loading } = useApi<FleetActivityResponse>(apiPath);

  const [liveEntries, setLiveEntries] = useState<EntryResponse[]>([]);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [recentlyArrived, setRecentlyArrived] = useState<Set<string>>(new Set());
  const [nowLinePulseKey, setNowLinePulseKey] = useState(0);
  const [nowLineBurstKey, setNowLineBurstKey] = useState(0);
  const arrivalRingRef = useRef<number[]>([]);
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const [measuredWidth, setMeasuredWidth] = useState(800);
  const [popover, setPopover] = useState<{
    cluster: SwarmCluster;
    anchor: { x: number; y: number };
  } | null>(null);

  // Seed live list from REST on every (re)fetch — clears stale SSE accretion.
  useEffect(() => {
    if (!data) return;
    setLiveEntries(data.entries);
    setRecentlyArrived(new Set());
    arrivalRingRef.current = [];
  }, [data]);

  useSSE<EntryResponse>(isToday ? "api/stream" : null, (entry) => {
    if (!entry.decision) return;
    const windowStart = data ? Date.parse(data.startTime) : 0;
    const ts = Date.parse(entry.timestamp);
    if (ts < windowStart) return;
    const key = entry.toolCallId ?? entry.timestamp;

    // Burst detection — the last N arrivals span < BURST_WINDOW_MS.
    const now = Date.now();
    const ring = arrivalRingRef.current;
    ring.push(now);
    if (ring.length > BURST_THRESHOLD) ring.shift();
    const burst = ring.length === BURST_THRESHOLD && now - ring[0] < BURST_WINDOW_MS;

    setLiveEntries((prev) => {
      if (prev.some((p) => p.toolCallId && p.toolCallId === entry.toolCallId)) return prev;
      const next = [...prev, entry];
      if (next.length > LIVE_CAP) next.shift();
      return next;
    });

    if (reducedMotion) return;
    if (burst) {
      setNowLineBurstKey((k) => k + 1);
      return;
    }
    setRecentlyArrived((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    setNowLinePulseKey((k) => k + 1);
    setTimeout(() => {
      setRecentlyArrived((prev) => {
        if (!prev.has(key)) return prev;
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }, ENTER_ANIMATION_MS);
  });

  // Leftward-sweep: advance nowMs every second so dots drift left under a
  // static viewBox. Off on past-date + reduced-motion (spec §3).
  useEffect(() => {
    if (!isToday || reducedMotion) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isToday, reducedMotion]);

  // Measure container width so timeToX lands pixel-perfect (SVG coord = px).
  useLayoutEffect(() => {
    if (!containerEl) return;
    const measure = () => {
      const rect = containerEl.getBoundingClientRect();
      setMeasuredWidth(Math.max(Math.floor(rect.width), 320));
    };
    measure();
    const ro =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(containerEl);
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [containerEl]);

  // Reset stuck UI when the range/date flips.
  useEffect(() => {
    setPopover(null);
  }, [range, selectedDate]);

  // Popover dismissal via Escape.
  useEffect(() => {
    if (!popover) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPopover(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [popover]);

  const chartH = fullscreen ? FULLSCREEN_CHART_HEIGHT : INLINE_CHART_HEIGHT;
  const laneH = laneHeight(chartH);

  const startMs = useMemo(() => {
    if (data) return Date.parse(data.startTime);
    return nowMs - parseRangeMs(range);
  }, [data, nowMs, range]);

  const endMs = useMemo(() => {
    if (isToday) return nowMs;
    if (data) return Date.parse(data.endTime);
    return nowMs;
  }, [isToday, nowMs, data]);

  const timeToX = useMemo(
    () => makeTimeToX(startMs, endMs, measuredWidth),
    [startMs, endMs, measuredWidth],
  );

  const clustersByLane = useMemo(() => {
    const perLane = new Map<ActivityCategory, SwarmDot[]>();
    for (const cat of LANE_ORDER) perLane.set(cat, []);
    for (const e of liveEntries) {
      const cat: ActivityCategory = (e.category ?? "scripts") as ActivityCategory;
      const bucket = perLane.get(cat);
      if (!bucket) continue;
      const key = e.toolCallId ?? e.timestamp;
      const cx = timeToX(Date.parse(e.timestamp));
      // Drop dots that have swept past the left edge.
      if (cx < -CLUSTER_RADIUS - 10) continue;
      const cy = laneYForCategory(cat, chartH) + jitterForKey(key, laneH);
      bucket.push({ entry: e, cx, cy });
    }
    const result = new Map<ActivityCategory, SwarmCluster[]>();
    for (const cat of LANE_ORDER) {
      result.set(cat, clusterDots(perLane.get(cat) ?? [], CLUSTER_PX));
    }
    return result;
  }, [liveEntries, timeToX, chartH, laneH]);

  const axisTicks = useMemo(() => {
    if (range === "7d") return buildDayTicks(startMs, endMs);
    return buildHourTicks(startMs, endMs, range);
  }, [range, startMs, endMs]);
  const labelShown = useMemo(
    () => cullLabelsForWidth(axisTicks, timeToX),
    [axisTicks, timeToX],
  );

  // ── Handlers ──

  const handleNavigateEntry = useCallback(
    (entry: EntryResponse) => {
      if (!entry.sessionKey) return;
      navigate(`/session/${encodeURIComponent(entry.sessionKey)}`, {
        state: { highlightToolCallId: entry.toolCallId },
      });
    },
    [navigate],
  );

  const handleDotClick = useCallback(
    (cluster: SwarmCluster, event: React.MouseEvent<SVGGElement>) => {
      if (!cluster.isCluster) {
        handleNavigateEntry(cluster.dots[0].entry);
        return;
      }
      setPopover({
        cluster,
        anchor: { x: event.clientX, y: event.clientY },
      });
    },
    [handleNavigateEntry],
  );

  // ── Render ──

  if (loading && !data) {
    return (
      <div className="cl-swarm-wrapper" data-cl-swarm-chart>
        <div
          className="flex items-center mb-3 flex-wrap"
          style={{ gap: 8 }}
        >
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
          Loading…
        </p>
      </div>
    );
  }

  const hasDots = liveEntries.length > 0;
  const leftEdge = measuredWidth * LEFT_EDGE_FADE_PCT;
  const nowX = isToday
    ? Math.min(measuredWidth, Math.max(0, timeToX(nowMs)))
    : 0;

  return (
    <div className="cl-swarm-wrapper" data-cl-swarm-chart>
      {/* Header */}
      <div className="flex items-center mb-3 flex-wrap" style={{ gap: 8 }}>
        <span
          className="font-display text-sm font-medium"
          style={{ color: "var(--cl-text-secondary)" }}
        >
          Fleet Activity
        </span>
        {onRangeChange && <RangePillGroup value={range} onChange={onRangeChange} />}
        {onToggleFullscreen && (
          <button
            type="button"
            onClick={onToggleFullscreen}
            data-cl-swarm-fullscreen-toggle
            data-cl-chart-fullscreen-toggle
            className="cl-btn-subtle"
            style={{ height: 24, padding: "0 8px", marginLeft: "auto" }}
            aria-label={fullscreen ? "Exit fullscreen" : "Expand fleet chart"}
            autoFocus={fullscreen}
          >
            {fullscreen ? (
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
        style={{ position: "relative", height: chartH }}
        data-cl-swarm-body
      >
        <svg
          width={measuredWidth}
          height={chartH}
          viewBox={`0 0 ${measuredWidth} ${chartH}`}
          style={{ display: "block" }}
        >
          <title>Fleet activity swarm chart</title>
          {/* Now line (today only) */}
          {isToday && (
            <line
              data-cl-swarm-now-line
              key={`now-${nowLinePulseKey}-${nowLineBurstKey}`}
              x1={nowX}
              x2={nowX}
              y1={0}
              y2={chartH}
              stroke="var(--cl-text-primary)"
              strokeWidth={1}
              strokeOpacity={0.2}
              className={
                reducedMotion
                  ? undefined
                  : nowLineBurstKey > 0
                    ? "cl-now-line-burst"
                    : nowLinePulseKey > 0
                      ? "cl-now-line-pulse"
                      : undefined
              }
            />
          )}

          {/* Dots + clusters */}
          {LANE_ORDER.map((cat) => {
            const clusters = clustersByLane.get(cat) ?? [];
            return clusters.map((c) => {
              const tier = c.worstTier;
              const halo = haloRadiusOffset(tier);
              const r = c.isCluster ? CLUSTER_RADIUS : DOT_RADIUS;
              const color = CATEGORY_META[cat]?.color ?? "var(--cl-text-muted)";
              const fadeOpacity =
                c.cx < leftEdge ? Math.max(0, 0.9 * (c.cx / leftEdge)) : 0.9;
              const firstEntry = c.dots[0].entry;
              const clickable = c.isCluster || Boolean(firstEntry.sessionKey);
              const enterKey = c.isCluster
                ? null
                : (firstEntry.toolCallId ?? firstEntry.timestamp);
              const enterClass =
                !c.isCluster && enterKey && recentlyArrived.has(enterKey)
                  ? "cl-swarm-dot-enter"
                  : undefined;
              const reactKey = c.isCluster
                ? `cluster-${cat}-${c.cx.toFixed(3)}-${c.dots.length}`
                : (enterKey ?? `${cat}-${c.cx.toFixed(3)}`);
              return (
                <g
                  key={reactKey}
                  data-cl-swarm-dot
                  data-cl-swarm-cluster={c.isCluster ? "true" : "false"}
                  data-cl-swarm-cat={cat}
                  data-cl-swarm-tier={tier ?? ""}
                  data-cl-swarm-clickable={clickable ? "true" : "false"}
                  className={enterClass}
                  style={{ cursor: clickable ? "pointer" : "default" }}
                  onClick={clickable ? (e) => handleDotClick(c, e) : undefined}
                >
                  {halo > 0 && (
                    <circle
                      data-cl-swarm-halo
                      cx={c.cx}
                      cy={c.cy}
                      r={r + halo}
                      fill="none"
                      stroke={
                        tier === "critical"
                          ? "var(--cl-risk-critical)"
                          : "var(--cl-risk-high)"
                      }
                      strokeWidth={tier === "critical" ? 2 : 1}
                      opacity={0.85}
                    >
                      {tier === "critical" && !reducedMotion && (
                        <animate
                          attributeName="r"
                          values={`${r + halo};${r + halo + 2};${r + halo}`}
                          dur="2s"
                          repeatCount="indefinite"
                        />
                      )}
                    </circle>
                  )}
                  <circle
                    cx={c.cx}
                    cy={c.cy}
                    r={r}
                    fill={color}
                    opacity={fadeOpacity}
                  />
                  {c.isCluster && (
                    <text
                      data-cl-swarm-cluster-count
                      x={c.cx}
                      y={c.cy - r - 4}
                      textAnchor="middle"
                      className="label-mono"
                      style={{ fill: "var(--cl-text-secondary)", fontSize: 10 }}
                    >
                      {c.dots.length}
                    </text>
                  )}
                </g>
              );
            });
          })}
        </svg>

        {/* Empty state overlay (chart still renders so the axis stays visible). */}
        {!hasDots && (
          <p
            className="text-sm text-center"
            style={{
              position: "absolute",
              top: "50%",
              left: 0,
              right: 0,
              transform: "translateY(-50%)",
              color: "var(--cl-text-muted)",
              pointerEvents: "none",
            }}
          >
            {isToday ? "No agent activity yet" : "No agent activity on this day"}
          </p>
        )}
      </div>

      {/* Axis */}
      {measuredWidth > 0 && (
        <div
          className="flex"
          style={{ marginTop: 4, height: 16 }}
          data-cl-swarm-axis
        >
          <svg
            viewBox={`0 0 ${measuredWidth} 16`}
            width={measuredWidth}
            height={16}
            style={{ display: "block" }}
          >
            <title>Time axis</title>
            <line
              x1={0}
              x2={measuredWidth}
              y1={0.5}
              y2={0.5}
              stroke="var(--cl-border-subtle)"
              strokeWidth={0.5}
            />
            {axisTicks.map((t) => {
              const tx = timeToX(t.ms);
              if (tx < 0 || tx > measuredWidth) return null;
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
                      style={{ fill: "var(--cl-text-muted)", fontSize: 10 }}
                    >
                      {t.label}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      )}

      {/* Legend */}
      <div
        className="flex items-center flex-wrap"
        style={{ gap: 12, marginTop: 8 }}
        data-cl-swarm-legend
      >
        {LANE_ORDER.map((cat) => {
          const meta = CATEGORY_META[cat];
          return (
            <span
              key={cat}
              className="inline-flex items-center"
              style={{ gap: 6 }}
              data-cl-swarm-legend-chip={cat}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke={meta.color}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d={meta.iconPath} />
              </svg>
              <span
                style={{
                  color: "var(--cl-text-muted)",
                  fontSize: 11,
                  fontFamily: "var(--cl-font-mono)",
                }}
              >
                {meta.label}
              </span>
            </span>
          );
        })}
      </div>

      {popover && (
        <SwarmPopover
          cluster={popover.cluster}
          anchor={popover.anchor}
          onClose={() => setPopover(null)}
          onNavigate={(entry) => {
            handleNavigateEntry(entry);
            setPopover(null);
          }}
        />
      )}
    </div>
  );
}

/** Local copy of the backend's parseRangeMs — takes a frontend RangeOption. */
function parseRangeMs(range: RangeOption): number {
  const m = range.match(/^(\d+)h$/);
  if (m) return Number(m[1]) * 3_600_000;
  const d = range.match(/^(\d+)d$/);
  if (d) return Number(d[1]) * 86_400_000;
  return 12 * 3_600_000;
}

/** Silence unused imports lint when tier is used only for type narrowing. */
export type { RiskTier };
