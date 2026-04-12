import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { useSSE } from "../hooks/useSSE";
import type {
  ActivityTimelineResponse,
  ActivityTimelineBucket,
  ActivityCategory,
  EntryResponse,
} from "../lib/types";
import { riskTierFromScore, riskColorRaw } from "../lib/utils";
import GradientAvatar from "./GradientAvatar";
import LiveIndicator from "./LiveIndicator";

interface Props {
  isToday: boolean;
  selectedDate: string | null;
}

const CATEGORY_COLORS: Record<ActivityCategory, string> = {
  exploring: "#4ade80",
  commands: "#a78bfa",
  web: "#60a5fa",
  comms: "#fbbf24",
  changes: "#f97316",
  data: "#14b8a6",
};

const CATEGORY_LABELS: Record<ActivityCategory, string> = {
  exploring: "exploring",
  commands: "commands",
  web: "web",
  comms: "comms",
  changes: "changes",
  data: "data",
};

const ALL_CATEGORIES: ActivityCategory[] = [
  "exploring",
  "commands",
  "web",
  "comms",
  "changes",
  "data",
];

const RANGE_OPTIONS = ["24h", "12h", "6h", "3h", "1h"] as const;
type RangeOption = (typeof RANGE_OPTIONS)[number];

const RANGE_BUCKET_MS: Record<RangeOption, number> = {
  "24h": 30 * 60_000,
  "12h": 15 * 60_000,
  "6h": 15 * 60_000,
  "3h": 5 * 60_000,
  "1h": 5 * 60_000,
};

const TAG_DOT_COLORS: Record<string, string> = {
  destructive: "#ef4444",
  "sensitive-path": "#f97316",
  "network-write": "#eab308",
};

const ROW_HEIGHT = 56;
const LABEL_WIDTH = 130;
const TIME_AXIS_HEIGHT = 24;
const PAD_TOP = 8;
const ACTION_COUNT_WIDTH = 70;

function fmtHour(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "pm" : "am";
  const h12 = h % 12 || 12;
  if (m === 0) return `${h12}${ampm}`;
  return `${h12}:${String(m).padStart(2, "0")}${ampm}`;
}

function emptyCounts(): Record<ActivityCategory, number> {
  return { exploring: 0, changes: 0, commands: 0, web: 0, comms: 0, data: 0 };
}

function truncateKey(key: string, maxLen = 28): string {
  if (key.length <= maxLen) return key;
  return `${key.slice(0, maxLen - 1)}\u2026`;
}

export default function ActivityTimeline({ isToday, selectedDate }: Props) {
  const navigate = useNavigate();
  const [range, setRange] = useState<RangeOption>("24h");
  const [clickedBucket, setClickedBucket] = useState<ActivityTimelineBucket | null>(null);
  const [clickedPos, setClickedPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const bucketMs = RANGE_BUCKET_MS[range];

  const apiPath = useMemo(() => {
    const params = new URLSearchParams({ range });
    if (selectedDate) params.set("date", selectedDate);
    return `api/activity-timeline?${params}`;
  }, [selectedDate, range]);

  const { data: apiData, loading } = useApi<ActivityTimelineResponse>(apiPath);

  // Mutable state for SSE updates
  const [liveBuckets, setLiveBuckets] = useState<ActivityTimelineBucket[]>([]);
  const [liveAgents, setLiveAgents] = useState<string[]>([]);
  const [liveTotalActions, setLiveTotalActions] = useState(0);
  const [liveStartTime, setLiveStartTime] = useState("");
  const [liveEndTime, setLiveEndTime] = useState("");
  const [pulseKey, setPulseKey] = useState(0);

  const [hoveredBucket, setHoveredBucket] = useState<ActivityTimelineBucket | null>(null);
  const [hoveredPos, setHoveredPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [hoveredAgent, setHoveredAgent] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Seed live state from API response
  useEffect(() => {
    if (apiData) {
      setLiveBuckets(apiData.buckets);
      setLiveAgents(apiData.agents);
      setLiveTotalActions(apiData.totalActions);
      setLiveStartTime(apiData.startTime);
      setLiveEndTime(apiData.endTime);
    }
  }, [apiData]);

  // Close popover on click-outside or Escape
  useEffect(() => {
    if (!clickedBucket) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("[data-session-popover]")) return;
      setClickedBucket(null);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setClickedBucket(null);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [clickedBucket]);

  // SSE live updates (today only)
  useSSE<EntryResponse>(
    isToday ? "api/stream" : "",
    useCallback(
      (entry: EntryResponse) => {
        if (!isToday) return;
        const agentId = entry.agentId || "unknown";
        const ts = new Date(entry.timestamp).getTime();
        const bucketStart = Math.floor(ts / bucketMs) * bucketMs;
        const bucketStartIso = new Date(bucketStart).toISOString();
        const category = ("category" in entry ? (entry as { category: string }).category : "exploring") as ActivityCategory;
        const risk = entry.riskScore ?? 0;
        const sessionKey = entry.sessionKey ?? "unknown";
        const toolName = entry.toolName;
        const riskTags = entry.riskTags ?? [];

        setLiveBuckets((prev) => {
          const existing = prev.find(
            (b) => b.agentId === agentId && b.start === bucketStartIso,
          );
          if (existing) {
            return prev.map((b) => {
              if (b.agentId !== agentId || b.start !== bucketStartIso) return b;
              const counts = { ...b.counts };
              counts[category] = (counts[category] ?? 0) + 1;

              // Update sessions
              const sessions = b.sessions.map((s) =>
                s.key === sessionKey ? { ...s, count: s.count + 1 } : s,
              );
              if (!sessions.some((s) => s.key === sessionKey)) {
                sessions.push({ key: sessionKey, count: 1 });
              }
              sessions.sort((a, c) => c.count - a.count);

              // Update topTools
              const toolMap = new Map(b.topTools.map((t) => [t.name, t.count]));
              toolMap.set(toolName, (toolMap.get(toolName) ?? 0) + 1);
              const topTools = [...toolMap.entries()]
                .map(([name, count]) => ({ name, count }))
                .sort((a, c) => c.count - a.count)
                .slice(0, 3);

              // Update tags
              const tagSet = new Set(b.tags);
              for (const tag of riskTags) tagSet.add(tag);

              return {
                ...b,
                counts,
                total: b.total + 1,
                peakRisk: Math.max(b.peakRisk, risk),
                sessions,
                topTools,
                tags: [...tagSet],
              };
            });
          }
          return [
            ...prev,
            {
              start: bucketStartIso,
              agentId,
              counts: { ...emptyCounts(), [category]: 1 },
              total: 1,
              peakRisk: risk,
              sessions: [{ key: sessionKey, count: 1 }],
              topTools: [{ name: toolName, count: 1 }],
              tags: [...riskTags],
            },
          ];
        });

        setLiveAgents((prev) => {
          if (prev.includes(agentId)) return prev;
          return [...prev, agentId];
        });

        setLiveTotalActions((prev) => prev + 1);

        // Expand time range if needed
        setLiveStartTime((prev) => {
          if (!prev || bucketStartIso < prev) return bucketStartIso;
          return prev;
        });
        setLiveEndTime((prev) => {
          const bucketEndIso = new Date(bucketStart + bucketMs).toISOString();
          if (!prev || bucketEndIso > prev) return bucketEndIso;
          return prev;
        });

        setPulseKey((k) => k + 1);
      },
      [isToday, bucketMs],
    ),
  );

  // Use live state (seeded from API, updated by SSE)
  const agents = liveAgents;
  const buckets = liveBuckets;
  const totalActions = liveTotalActions;
  const startTime = liveStartTime;
  const endTime = liveEndTime;

  // Active categories
  const activeCategories = ALL_CATEGORIES.filter((cat) =>
    buckets.some((b) => b.counts[cat] > 0),
  );

  // Responsive chart width
  const containerRef = useRef<HTMLDivElement>(null);
  const [measuredWidth, setMeasuredWidth] = useState(800);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setMeasuredWidth(Math.max(Math.floor(entry.contentRect.width), 400));
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  if (loading && !apiData) {
    return (
      <div>
        <span className="font-display text-sm font-medium" style={{ color: "var(--cl-text-secondary)" }}>
          Fleet Activity
        </span>
        <p className="text-sm py-8 text-center" style={{ color: "var(--cl-text-muted)" }}>
          Loading...
        </p>
      </div>
    );
  }

  if (totalActions === 0) {
    return (
      <div>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <span className="font-display text-sm font-medium" style={{ color: "var(--cl-text-secondary)" }}>
            Fleet Activity
          </span>
          <RangeSelector range={range} onRangeChange={setRange} />
        </div>
        <p className="text-sm py-8 text-center" style={{ color: "var(--cl-text-muted)" }}>
          {isToday ? "No activity yet" : "No activity on this day"}
        </p>
        <div className="text-center">
          <Link to="/activity" className="text-xs" style={{ color: "var(--cl-text-muted)" }}>
            View all activity &rarr;
          </Link>
        </div>
      </div>
    );
  }

  const startMs = new Date(startTime).getTime();
  const endMs = isToday ? Date.now() : new Date(endTime).getTime();
  const spanMs = endMs - startMs || 1;

  const maxBucketTotal = Math.max(...buckets.map((b) => b.total), 1);

  // Per-agent totals (re-sort by total desc)
  const agentTotals = new Map<string, number>();
  for (const b of buckets) {
    agentTotals.set(b.agentId, (agentTotals.get(b.agentId) ?? 0) + b.total);
  }
  const sortedAgents = [...agents].sort(
    (a, b) => (agentTotals.get(b) ?? 0) - (agentTotals.get(a) ?? 0),
  );

  // SVG dimensions
  const chartWidth = measuredWidth;
  const swimlaneWidth = chartWidth - LABEL_WIDTH - ACTION_COUNT_WIDTH;
  const chartHeight = PAD_TOP + sortedAgents.length * ROW_HEIGHT + TIME_AXIS_HEIGHT;

  const timeToX = (ms: number) => LABEL_WIDTH + ((ms - startMs) / spanMs) * swimlaneWidth;
  const barWidth = Math.max(3, (bucketMs / spanMs) * swimlaneWidth - 1);

  // Hour ticks — use smaller intervals for short ranges
  const tickInterval = range === "1h" || range === "3h" ? 1_800_000 : 3_600_000;
  const hourTicks: { ms: number; label: string }[] = [];
  const firstTick = Math.ceil(startMs / tickInterval) * tickInterval;
  for (let t = firstTick; t <= endMs; t += tickInterval) {
    hourTicks.push({ ms: t, label: fmtHour(t) });
  }

  const nowX = isToday ? timeToX(Date.now()) : null;

  const handleBucketHover = (
    bucket: ActivityTimelineBucket | null,
    event?: React.MouseEvent,
  ) => {
    setHoveredBucket(bucket);
    if (bucket && event && wrapperRef.current) {
      const rect = wrapperRef.current.getBoundingClientRect();
      setHoveredPos({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    }
  };

  const handleBucketClick = (
    bucket: ActivityTimelineBucket,
    event: React.MouseEvent,
  ) => {
    if (bucket.sessions.length === 1) {
      navigate(`/session/${encodeURIComponent(bucket.sessions[0].key)}`);
    } else if (bucket.sessions.length > 1) {
      if (wrapperRef.current) {
        const rect = wrapperRef.current.getBoundingClientRect();
        setClickedPos({ x: event.clientX - rect.left, y: event.clientY - rect.top });
      }
      setClickedBucket(bucket);
    }
  };

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <span className="font-display text-sm font-medium" style={{ color: "var(--cl-text-secondary)" }}>
            Fleet Activity
          </span>
          {isToday && <LiveIndicator pulseKey={pulseKey} />}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Inline legend */}
          {activeCategories.map((cat) => (
            <span key={cat} className="flex items-center gap-1">
              <span
                className="inline-block rounded-sm"
                style={{
                  width: 10,
                  height: 10,
                  backgroundColor: CATEGORY_COLORS[cat],
                  opacity: 0.85,
                }}
              />
              <span className="font-mono text-[10px]" style={{ color: "var(--cl-text-muted)" }}>
                {CATEGORY_LABELS[cat]}
              </span>
            </span>
          ))}
          <RangeSelector range={range} onRangeChange={setRange} />
        </div>
      </div>

      {/* Chart */}
      <div ref={containerRef}>
      <svg
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        className="w-full overflow-visible"
      >
        <defs>
          <filter id="risk-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Agent rows */}
        {sortedAgents.map((agentId, rowIdx) => {
          const rowY = PAD_TOP + rowIdx * ROW_HEIGHT;
          const total = agentTotals.get(agentId) ?? 0;
          const isDimmed = hoveredAgent !== null && hoveredAgent !== agentId;

          return (
            <g
              key={agentId}
              opacity={isDimmed ? 0.3 : 1}
              style={{
                transition: "opacity 0.2s",
                transformOrigin: `0 ${rowY + ROW_HEIGHT}px`,
                animation: `timeline-bar-grow 0.5s var(--cl-spring) both`,
                animationDelay: `${rowIdx * 50}ms`,
              }}
            >
              {/* Alternating row background */}
              {rowIdx % 2 === 0 && (
                <rect
                  x={0}
                  y={rowY}
                  width={chartWidth}
                  height={ROW_HEIGHT}
                  fill="var(--cl-elevated)"
                  opacity={0.3}
                />
              )}

              {/* Hover hit area — click navigates to agent */}
              <rect
                x={0}
                y={rowY}
                width={chartWidth}
                height={ROW_HEIGHT}
                fill="transparent"
                onMouseEnter={() => setHoveredAgent(agentId)}
                onMouseLeave={() => setHoveredAgent(null)}
              />

              {/* Agent label — clickable */}
              <g
                onClick={() => navigate(`/agent/${encodeURIComponent(agentId)}`)}
                style={{ cursor: "pointer" }}
              >
                <text
                  x={4}
                  y={rowY + ROW_HEIGHT / 2 + 1}
                  dominantBaseline="central"
                  style={{
                    fill: "var(--cl-text-primary)",
                    fontSize: 12,
                    fontWeight: 500,
                    fontFamily: "'DM Sans', sans-serif",
                  }}
                >
                  {agentId.length > 14 ? `${agentId.slice(0, 13)}\u2026` : agentId}
                </text>
              </g>

              {/* Swimlane baseline */}
              <line
                x1={LABEL_WIDTH}
                y1={rowY + ROW_HEIGHT - 8}
                x2={LABEL_WIDTH + swimlaneWidth}
                y2={rowY + ROW_HEIGHT - 8}
                stroke="var(--cl-border-subtle)"
                strokeWidth={0.5}
              />

              {/* Bucket bars */}
              {buckets
                .filter((b) => b.agentId === agentId)
                .map((bucket) => {
                  const bMs = new Date(bucket.start).getTime();
                  const bx = timeToX(bMs);
                  const opacity = 0.5 + 0.5 * (bucket.total / maxBucketTotal);
                  const maxBarH = ROW_HEIGHT - 16;
                  const hasHighRisk = bucket.peakRisk >= 60;

                  let segY = rowY + ROW_HEIGHT - 8;
                  const segments: React.ReactElement[] = [];

                  for (const cat of ALL_CATEGORIES) {
                    const count = bucket.counts[cat];
                    if (count === 0) continue;
                    const segH = Math.max(6, (count / bucket.total) * maxBarH);
                    segY -= segH;
                    segments.push(
                      <rect
                        key={cat}
                        x={bx}
                        y={segY}
                        width={barWidth}
                        height={segH}
                        rx={2}
                        fill={CATEGORY_COLORS[cat]}
                        opacity={opacity}
                      />,
                    );
                  }

                  // Session boundary dividers (multiple sessions)
                  const sessionDividers: React.ReactElement[] = [];
                  if (bucket.sessions.length > 1 && barWidth >= 10) {
                    const barTop = segY;
                    const barH = rowY + ROW_HEIGHT - 8 - barTop;
                    const totalSessions = bucket.sessions.length;
                    for (let i = 1; i < totalSessions && i < 4; i++) {
                      const divY = barTop + (barH * i) / totalSessions;
                      sessionDividers.push(
                        <line
                          key={`div-${i}`}
                          x1={bx + 1}
                          y1={divY}
                          x2={bx + barWidth - 1}
                          y2={divY}
                          stroke="rgba(0,0,0,0.3)"
                          strokeWidth={0.5}
                          strokeDasharray="2,2"
                        />,
                      );
                    }
                  }

                  // Tag indicator dots
                  const tagDots: React.ReactElement[] = [];
                  if (barWidth >= 20 && bucket.tags.length > 0) {
                    let dotIdx = 0;
                    for (const [tag, color] of Object.entries(TAG_DOT_COLORS)) {
                      if (dotIdx >= 3) break;
                      if (bucket.tags.includes(tag)) {
                        tagDots.push(
                          <circle
                            key={tag}
                            cx={bx + 4 + dotIdx * 6}
                            cy={segY - 4}
                            r={2}
                            fill={color}
                          />,
                        );
                        dotIdx++;
                      }
                    }
                  }

                  // Tool label inside bar at zoom
                  const toolLabel =
                    barWidth >= 40 && bucket.topTools.length > 0 ? (
                      <text
                        x={bx + barWidth / 2}
                        y={rowY + ROW_HEIGHT - 8 - (rowY + ROW_HEIGHT - 8 - segY) / 2}
                        textAnchor="middle"
                        dominantBaseline="central"
                        style={{
                          fill: "rgba(255,255,255,0.85)",
                          fontSize: 8,
                          fontFamily: "var(--cl-font-mono, monospace)",
                          pointerEvents: "none",
                        }}
                      >
                        {bucket.topTools[0].name.length > 6
                          ? `${bucket.topTools[0].name.slice(0, 5)}\u2026`
                          : bucket.topTools[0].name}
                      </text>
                    ) : null;

                  return (
                    <g
                      key={bucket.start}
                      filter={hasHighRisk ? "url(#risk-glow)" : undefined}
                      onMouseEnter={(e) => handleBucketHover(bucket, e)}
                      onMouseMove={(e) => handleBucketHover(bucket, e)}
                      onMouseLeave={() => handleBucketHover(null)}
                      onClick={(e) => handleBucketClick(bucket, e)}
                      style={{ cursor: "pointer" }}
                    >
                      {segments}
                      {sessionDividers}
                      {tagDots}
                      {toolLabel}
                      <rect
                        x={bx}
                        y={rowY}
                        width={barWidth}
                        height={ROW_HEIGHT}
                        fill="transparent"
                      />
                    </g>
                  );
                })}

              {/* Action count (right side) */}
              <text
                x={LABEL_WIDTH + swimlaneWidth + 8}
                y={rowY + ROW_HEIGHT / 2 + 1}
                dominantBaseline="central"
                className="label-mono"
                style={{ fill: "var(--cl-text-muted)", fontSize: 10 }}
              >
                {total}
              </text>
            </g>
          );
        })}

        {/* Time axis */}
        {(() => {
          const axisY = PAD_TOP + sortedAgents.length * ROW_HEIGHT + 4;
          return (
            <>
              <line
                x1={LABEL_WIDTH}
                y1={axisY}
                x2={LABEL_WIDTH + swimlaneWidth}
                y2={axisY}
                stroke="var(--cl-border-subtle)"
                strokeWidth={0.5}
              />
              {hourTicks.map((tick) => {
                const tx = timeToX(tick.ms);
                if (tx < LABEL_WIDTH || tx > LABEL_WIDTH + swimlaneWidth) return null;
                return (
                  <g key={tick.ms}>
                    <line
                      x1={tx}
                      y1={axisY}
                      x2={tx}
                      y2={axisY + 4}
                      stroke="var(--cl-text-muted)"
                      strokeWidth={0.5}
                    />
                    <text
                      x={tx}
                      y={axisY + 16}
                      textAnchor="middle"
                      className="label-mono"
                      style={{ fill: "var(--cl-text-muted)", fontSize: 9 }}
                    >
                      {tick.label}
                    </text>
                  </g>
                );
              })}

              {/* NOW marker */}
              {nowX !== null &&
                nowX >= LABEL_WIDTH &&
                nowX <= LABEL_WIDTH + swimlaneWidth && (
                  <>
                    {/* Solid line */}
                    <line
                      x1={nowX}
                      y1={PAD_TOP + 10}
                      x2={nowX}
                      y2={axisY}
                      stroke="var(--cl-accent)"
                      strokeWidth={1.5}
                    >
                      <animate
                        attributeName="opacity"
                        values="0.4;0.8;0.4"
                        dur="2s"
                        repeatCount="indefinite"
                      />
                    </line>
                    {/* Triangle at top */}
                    <polygon
                      points={`${nowX - 4},${PAD_TOP + 2} ${nowX + 4},${PAD_TOP + 2} ${nowX},${PAD_TOP + 10}`}
                      fill="var(--cl-accent)"
                    >
                      <animate
                        attributeName="opacity"
                        values="0.4;0.8;0.4"
                        dur="2s"
                        repeatCount="indefinite"
                      />
                    </polygon>
                    {/* NOW label at top */}
                    <text
                      x={nowX}
                      y={PAD_TOP - 2}
                      textAnchor="middle"
                      className="label-mono"
                      style={{ fill: "var(--cl-accent)", fontSize: 9 }}
                    >
                      NOW
                    </text>
                  </>
                )}
            </>
          );
        })()}
      </svg>
      </div>

      {/* Tooltip */}
      {hoveredBucket && !clickedBucket && (
        <BucketTooltip bucket={hoveredBucket} pos={hoveredPos} bucketMs={bucketMs} />
      )}

      {/* Session popover */}
      {clickedBucket && (
        <SessionPopover
          bucket={clickedBucket}
          pos={clickedPos}
          onNavigate={(sessionKey) => {
            setClickedBucket(null);
            navigate(`/session/${encodeURIComponent(sessionKey)}`);
          }}
          onClose={() => setClickedBucket(null)}
        />
      )}

      {/* View all link */}
      <div className="mt-3 text-center">
        <Link to="/activity" className="text-xs" style={{ color: "var(--cl-text-muted)" }}>
          View all activity &rarr;
        </Link>
      </div>
    </div>
  );
}

function RangeSelector({
  range,
  onRangeChange,
}: {
  range: RangeOption;
  onRangeChange: (r: RangeOption) => void;
}) {
  return (
    <div className="flex items-center" style={{ gap: 1 }}>
      {RANGE_OPTIONS.map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => onRangeChange(r)}
          className="font-mono"
          style={{
            fontSize: 10,
            padding: "2px 6px",
            borderRadius: 4,
            border: "none",
            cursor: "pointer",
            background: r === range ? "var(--cl-accent)" : "transparent",
            color: r === range ? "var(--cl-bg)" : "var(--cl-text-muted)",
            fontWeight: r === range ? 700 : 400,
            transition: "all 0.15s ease",
          }}
        >
          {r}
        </button>
      ))}
    </div>
  );
}

function BucketTooltip({
  bucket,
  pos,
  bucketMs,
}: {
  bucket: ActivityTimelineBucket;
  pos: { x: number; y: number };
  bucketMs: number;
}) {
  const startTime = new Date(bucket.start);
  const endTime = new Date(startTime.getTime() + bucketMs);
  const fmt = (d: Date) =>
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });

  const tier = riskTierFromScore(bucket.peakRisk);
  const activeCats = ALL_CATEGORIES.filter((c) => bucket.counts[c] > 0);
  const maxCatCount = Math.max(...activeCats.map((c) => bucket.counts[c]), 1);

  const tooltipW = 230;
  let left = pos.x - tooltipW / 2;
  left = Math.max(4, left);
  const top = pos.y - 12;

  const displaySessions = bucket.sessions.slice(0, 3);
  const extraSessions = bucket.sessions.length - 3;

  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        transform: "translateY(-100%)",
        width: tooltipW,
        background: "var(--cl-elevated)",
        border: "1px solid var(--cl-border-subtle)",
        borderRadius: 10,
        padding: "10px 14px",
        fontSize: 11,
        fontFamily: "var(--cl-font-mono, monospace)",
        boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
        pointerEvents: "none",
        zIndex: 10,
        animation: "cascade-in 0.15s ease-out both",
      }}
    >
      {/* Agent + avatar */}
      <div className="flex items-center gap-2 mb-1">
        <GradientAvatar agentId={bucket.agentId} size="sm" />
        <span style={{ color: "var(--cl-text-primary)", fontWeight: 600, fontSize: 12 }}>
          {bucket.agentId}
        </span>
      </div>

      {/* Time range */}
      <div style={{ color: "var(--cl-text-muted)", marginBottom: 6, fontWeight: 600 }}>
        {fmt(startTime)} – {fmt(endTime)}
      </div>

      {/* Sessions */}
      {bucket.sessions.length > 0 && (
        <div style={{ marginBottom: 6 }}>
          <div style={{ color: "var(--cl-text-secondary)", fontSize: 10, marginBottom: 2 }}>
            Sessions: {bucket.sessions.length}
          </div>
          {displaySessions.map((s) => (
            <div key={s.key} style={{ color: "var(--cl-text-muted)", fontSize: 10 }}>
              {truncateKey(s.key, 24)} ({s.count})
            </div>
          ))}
          {extraSessions > 0 && (
            <div style={{ color: "var(--cl-text-muted)", fontSize: 10 }}>
              +{extraSessions} more
            </div>
          )}
        </div>
      )}

      {/* Top tools */}
      {bucket.topTools.length > 0 && (
        <div style={{ marginBottom: 6 }}>
          <span style={{ color: "var(--cl-text-secondary)", fontSize: 10 }}>Top tools: </span>
          <span style={{ color: "var(--cl-text-muted)", fontSize: 10 }}>
            {bucket.topTools.map((t) => `${t.name} (${t.count})`).join(" \u00b7 ")}
          </span>
        </div>
      )}

      {/* Category mini bar + counts */}
      {activeCats.map((cat) => (
        <div key={cat} className="flex items-center gap-2 mb-1">
          <span
            className="inline-block rounded-sm"
            style={{
              width: 8,
              height: 8,
              backgroundColor: CATEGORY_COLORS[cat],
              flexShrink: 0,
            }}
          />
          <div
            className="h-1.5 rounded-full"
            style={{
              width: `${(bucket.counts[cat] / maxCatCount) * 60}px`,
              backgroundColor: CATEGORY_COLORS[cat],
              opacity: 0.7,
            }}
          />
          <span style={{ color: "var(--cl-text-secondary)", fontSize: 10 }}>
            {CATEGORY_LABELS[cat]} {bucket.counts[cat]}
          </span>
        </div>
      ))}

      {/* Tags */}
      {bucket.tags.length > 0 && (
        <div className="mt-1" style={{ color: "var(--cl-text-muted)", fontSize: 10 }}>
          Tags: {bucket.tags.join(", ")}
        </div>
      )}

      {/* Peak risk */}
      <div className="mt-2 flex items-center gap-1.5">
        <span
          className="inline-block w-1.5 h-1.5 rounded-full"
          style={{ backgroundColor: riskColorRaw(tier) }}
        />
        <span style={{ color: riskColorRaw(tier), fontSize: 10 }}>
          peak {bucket.peakRisk} {tier.toUpperCase()}
        </span>
      </div>

      {/* Click hint */}
      <div className="mt-1" style={{ color: "var(--cl-text-muted)", fontSize: 9, opacity: 0.7 }}>
        Click to view session{bucket.sessions.length > 1 ? "s" : ""}
      </div>
    </div>
  );
}

function SessionPopover({
  bucket,
  pos,
  onNavigate,
  onClose,
}: {
  bucket: ActivityTimelineBucket;
  pos: { x: number; y: number };
  onNavigate: (sessionKey: string) => void;
  onClose: () => void;
}) {
  const popoverW = 260;
  let left = pos.x - popoverW / 2;
  left = Math.max(4, left);
  const top = pos.y + 8;

  return (
    <div
      data-session-popover
      style={{
        position: "absolute",
        left,
        top,
        width: popoverW,
        background: "var(--cl-elevated)",
        border: "1px solid var(--cl-border-subtle)",
        borderRadius: 10,
        padding: "10px 14px",
        fontSize: 11,
        fontFamily: "var(--cl-font-mono, monospace)",
        boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
        zIndex: 20,
        animation: "cascade-in 0.15s ease-out both",
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <span style={{ color: "var(--cl-text-secondary)", fontSize: 10, fontWeight: 600 }}>
          {bucket.sessions.length} sessions
        </span>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "var(--cl-text-muted)",
            cursor: "pointer",
            fontSize: 14,
            lineHeight: 1,
            padding: 0,
          }}
        >
          &times;
        </button>
      </div>
      {bucket.sessions.map((s) => (
        <button
          key={s.key}
          type="button"
          onClick={() => onNavigate(s.key)}
          className="w-full text-left flex items-center justify-between py-1 px-1 rounded"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--cl-text-primary)",
            fontSize: 11,
            fontFamily: "var(--cl-font-mono, monospace)",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = "var(--cl-border-subtle)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "none";
          }}
        >
          <span>{truncateKey(s.key, 26)}</span>
          <span style={{ color: "var(--cl-text-muted)", fontSize: 10 }}>
            {s.count} actions
          </span>
        </button>
      ))}
    </div>
  );
}
