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

const INLINE_CHART_HEIGHT = 200;
const FULLSCREEN_CHART_HEIGHT = 360;
const DOT_RADIUS = 8;
const CLUSTER_RADIUS = 10;
/** Icon glyph — the dot IS the icon now (no fill disc). 14px gives it more
 *  presence in the chart than the 12px legend glyphs. */
const DOT_ICON_SIZE = 14;
const LIVE_CAP = 5000;
const LEFT_EDGE_FADE_PCT = 0.05;
const ENTER_ANIMATION_MS = 280;
const BURST_WINDOW_MS = 1000;
const BURST_THRESHOLD = 10;
/** Fixed-width left gutter that holds the always-visible lane icons + labels. */
const GUTTER_W = 96;
/** Icon glyph size in the gutter. 14px matches the agent-card category strip. */
const LANE_ICON_SIZE = 14;
/** Distance the now-line hangs inside the right edge so it's not half-clipped. */
const NOW_LINE_INSET = 4;

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
  /** Chart width = total measured width minus the fixed-width lane-label
   *  gutter. All X-mapping (timeToX, axis ticks, now line) is in this frame. */
  const chartWidth = Math.max(measuredWidth - GUTTER_W, 100);

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
    () => makeTimeToX(startMs, endMs, chartWidth),
    [startMs, endMs, chartWidth],
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
  const leftEdge = chartWidth * LEFT_EDGE_FADE_PCT;
  // Now-line clamps to chartWidth - NOW_LINE_INSET so the stroke never half-
  // clips against the SVG's right edge.
  const nowX = isToday
    ? Math.min(chartWidth - NOW_LINE_INSET, Math.max(0, timeToX(nowMs)))
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

      {/* Chart body — split into a fixed-width lane-label gutter on the left
          and a flex-1 swarm SVG on the right so lane labels stay visible even
          when all six lanes are empty. marginTop reserves room for both the
          NOW caption (lifted above y=0) and cluster '+N' labels that draw
          above the top lane; the main SVG has overflow="visible" below. */}
      <div
        ref={setContainerEl}
        style={{ position: "relative", height: chartH, display: "flex", marginTop: 20 }}
        data-cl-swarm-body
      >
        {/* Lane-label gutter — icon + text per category. Mirrors the
            CATEGORY_META palette used in agent cards and the bottom legend
            so the reviewer pattern-matches on the same glyphs. */}
        <svg
          width={GUTTER_W}
          height={chartH}
          viewBox={`0 0 ${GUTTER_W} ${chartH}`}
          style={{ display: "block", flex: `0 0 ${GUTTER_W}px` }}
          aria-hidden="true"
        >
          <title>Lane labels</title>
          {LANE_ORDER.map((cat) => {
            const meta = CATEGORY_META[cat];
            const cy = laneYForCategory(cat, chartH);
            return (
              <g key={cat}>
                <svg
                  data-cl-swarm-lane-icon={cat}
                  x={8}
                  y={cy - LANE_ICON_SIZE / 2}
                  width={LANE_ICON_SIZE}
                  height={LANE_ICON_SIZE}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={meta.color}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d={meta.iconPath} />
                </svg>
                <text
                  data-cl-swarm-lane-label={cat}
                  x={GUTTER_W - 8}
                  y={cy}
                  textAnchor="end"
                  dominantBaseline="middle"
                  style={{
                    fill: "var(--cl-text-subdued)",
                    fontFamily: "var(--cl-font-mono)",
                    fontSize: 10,
                  }}
                >
                  {meta.label}
                </text>
              </g>
            );
          })}
        </svg>
        <svg
          width={chartWidth}
          height={chartH}
          viewBox={`0 0 ${chartWidth} ${chartH}`}
          overflow="visible"
          style={{ display: "block", flex: 1 }}
        >
          <title>Fleet activity swarm chart</title>
          {/* Now line (today only) — persistent accent aura reads "live" at
              rest, pulse/burst keyframes modulate on SSE arrivals. The NOW
              caption + ▼ arrow above it anchors "this is now" visually so the
              line is unambiguous even when the chart is idle. */}
          {isToday && (
            <>
              <line
                data-cl-swarm-now-line
                key={`now-${nowLinePulseKey}-${nowLineBurstKey}`}
                x1={nowX}
                x2={nowX}
                y1={0}
                y2={chartH}
                stroke="var(--cl-accent)"
                strokeWidth={2}
                strokeOpacity={0.7}
                style={{ filter: "drop-shadow(0 0 3px var(--cl-accent))" }}
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
              <text
                data-cl-swarm-now-caption
                x={nowX}
                y={-6}
                textAnchor="end"
                style={{
                  fill: "var(--cl-accent)",
                  fontFamily: "var(--cl-font-mono)",
                  fontSize: 9,
                  fontWeight: 600,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                }}
              >
                NOW
              </text>
              <polygon
                data-cl-swarm-now-arrow
                points={`${nowX - 4},-2 ${nowX + 4},-2 ${nowX},4`}
                fill="var(--cl-accent)"
              />
            </>
          )}

          {/* Dots + clusters */}
          {LANE_ORDER.map((cat) => {
            const clusters = clustersByLane.get(cat) ?? [];
            return clusters.map((c) => {
              const tier = c.worstTier;
              const halo = haloRadiusOffset(tier);
              const r = c.isCluster ? CLUSTER_RADIUS : DOT_RADIUS;
              const meta = CATEGORY_META[cat];
              const color = meta?.color ?? "var(--cl-text-muted)";
              // Clamp to the now-line on today view — dots never appear in
              // the future half-second beyond `now`, regardless of SSE clock
              // skew. Past-date views have no now-line, no clamp.
              const cx = isToday ? Math.min(c.cx, nowX) : c.cx;
              const fadeOpacity =
                cx < leftEdge ? Math.max(0, 0.9 * (cx / leftEdge)) : 0.9;
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
                      cx={cx}
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
                  {meta && (
                    <svg
                      x={cx - DOT_ICON_SIZE / 2}
                      y={c.cy - DOT_ICON_SIZE / 2}
                      width={DOT_ICON_SIZE}
                      height={DOT_ICON_SIZE}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke={color}
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      pointerEvents="none"
                      opacity={fadeOpacity}
                    >
                      <path d={meta.iconPath} />
                    </svg>
                  )}
                  {/* Transparent hit target — stroke-only icons have thin hit
                      areas, so this circle gives clicks a comfortable landing
                      zone at r=DOT_RADIUS/CLUSTER_RADIUS. */}
                  <circle
                    cx={cx}
                    cy={c.cy}
                    r={r}
                    fill="transparent"
                    pointerEvents={clickable ? "auto" : "none"}
                  />
                  {c.isCluster && (
                    <text
                      data-cl-swarm-cluster-count
                      x={cx}
                      y={c.cy - r - 4}
                      textAnchor="middle"
                      className="label-mono"
                      style={{ fill: "var(--cl-text-muted)", fontSize: 10 }}
                    >
                      {`+${c.dots.length}`}
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

      {/* Axis — padded so ticks align with the main chart's x-frame. */}
      {chartWidth > 0 && (
        <div
          className="flex"
          style={{ marginTop: 4, height: 16, paddingLeft: GUTTER_W }}
          data-cl-swarm-axis
        >
          <svg
            viewBox={`0 0 ${chartWidth} 16`}
            width={chartWidth}
            height={16}
            style={{ display: "block" }}
          >
            <title>Time axis</title>
            <line
              x1={0}
              x2={chartWidth}
              y1={0.5}
              y2={0.5}
              stroke="var(--cl-border-subtle)"
              strokeWidth={0.5}
            />
            {axisTicks.map((t) => {
              const tx = timeToX(t.ms);
              if (tx < 0 || tx > chartWidth) return null;
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

      {/* Legend — padded so chips sit under the chart, not under the gutter. */}
      <div
        className="flex items-center flex-wrap"
        style={{ gap: 12, marginTop: 8, paddingLeft: GUTTER_W }}
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
