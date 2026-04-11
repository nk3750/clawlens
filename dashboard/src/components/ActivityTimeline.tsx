import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { Link } from "react-router-dom";
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

const ROW_HEIGHT = 56;
const LABEL_WIDTH = 130;
const TIME_AXIS_HEIGHT = 24;
const PAD_TOP = 8;
const ACTION_COUNT_WIDTH = 70;
const BUCKET_MS = 15 * 60_000;

function fmtHour(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  const ampm = h >= 12 ? "pm" : "am";
  const h12 = h % 12 || 12;
  return `${h12}${ampm}`;
}

function emptyCounts(): Record<ActivityCategory, number> {
  return { exploring: 0, changes: 0, commands: 0, web: 0, comms: 0, data: 0 };
}

export default function ActivityTimeline({ isToday, selectedDate }: Props) {
  const apiPath = useMemo(() => {
    const params = new URLSearchParams({ bucketMinutes: "15" });
    if (selectedDate) params.set("date", selectedDate);
    return `api/activity-timeline?${params}`;
  }, [selectedDate]);

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

  // SSE live updates (today only)
  useSSE<EntryResponse>(
    isToday ? "api/stream" : "",
    useCallback(
      (entry: EntryResponse) => {
        if (!isToday) return;
        const agentId = entry.agentId || "unknown";
        const ts = new Date(entry.timestamp).getTime();
        const bucketStart = Math.floor(ts / BUCKET_MS) * BUCKET_MS;
        const bucketStartIso = new Date(bucketStart).toISOString();
        const category = ("category" in entry ? (entry as { category: string }).category : "exploring") as ActivityCategory;
        const risk = entry.riskScore ?? 0;

        setLiveBuckets((prev) => {
          const existing = prev.find(
            (b) => b.agentId === agentId && b.start === bucketStartIso,
          );
          if (existing) {
            return prev.map((b) => {
              if (b.agentId !== agentId || b.start !== bucketStartIso) return b;
              const counts = { ...b.counts };
              counts[category] = (counts[category] ?? 0) + 1;
              return {
                ...b,
                counts,
                total: b.total + 1,
                peakRisk: Math.max(b.peakRisk, risk),
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
          const bucketEndIso = new Date(bucketStart + BUCKET_MS).toISOString();
          if (!prev || bucketEndIso > prev) return bucketEndIso;
          return prev;
        });

        setPulseKey((k) => k + 1);
      },
      [isToday],
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

  if (loading && !apiData) {
    return (
      <div className="mt-8">
        <span className="label-mono" style={{ color: "var(--cl-text-muted)" }}>
          FLEET ACTIVITY
        </span>
        <p className="text-sm py-8 text-center" style={{ color: "var(--cl-text-muted)" }}>
          Loading...
        </p>
      </div>
    );
  }

  if (totalActions === 0) {
    return (
      <div className="mt-8">
        <span className="label-mono" style={{ color: "var(--cl-text-muted)" }}>
          FLEET ACTIVITY
        </span>
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
  const chartWidth = 800;
  const swimlaneWidth = chartWidth - LABEL_WIDTH - ACTION_COUNT_WIDTH;
  const chartHeight = PAD_TOP + sortedAgents.length * ROW_HEIGHT + TIME_AXIS_HEIGHT;

  const timeToX = (ms: number) => LABEL_WIDTH + ((ms - startMs) / spanMs) * swimlaneWidth;
  const barWidth = Math.max(3, (BUCKET_MS / spanMs) * swimlaneWidth - 1);

  // Hour ticks
  const hourTicks: { ms: number; label: string }[] = [];
  const firstHour = Math.ceil(startMs / 3_600_000) * 3_600_000;
  for (let t = firstHour; t <= endMs; t += 3_600_000) {
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

  return (
    <div className="mt-8" ref={wrapperRef} style={{ position: "relative" }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <span className="label-mono" style={{ color: "var(--cl-text-muted)" }}>
            FLEET ACTIVITY
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
          <span className="font-mono text-xs" style={{ color: "var(--cl-text-secondary)" }}>
            {totalActions} {isToday ? "today" : "actions"}
          </span>
        </div>
      </div>

      {/* Chart */}
      <svg
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        className="w-full overflow-visible"
        style={{ maxWidth: chartWidth }}
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

              {/* Hover hit area */}
              <rect
                x={0}
                y={rowY}
                width={chartWidth}
                height={ROW_HEIGHT}
                fill="transparent"
                onMouseEnter={() => setHoveredAgent(agentId)}
                onMouseLeave={() => setHoveredAgent(null)}
              />

              {/* Agent label */}
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

                  return (
                    <g
                      key={bucket.start}
                      filter={hasHighRisk ? "url(#risk-glow)" : undefined}
                      onMouseEnter={(e) => handleBucketHover(bucket, e)}
                      onMouseMove={(e) => handleBucketHover(bucket, e)}
                      onMouseLeave={() => handleBucketHover(null)}
                      style={{ cursor: "default" }}
                    >
                      {segments}
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

      {/* Tooltip */}
      {hoveredBucket && <BucketTooltip bucket={hoveredBucket} pos={hoveredPos} />}

      {/* View all link */}
      <div className="mt-3 text-center">
        <Link to="/activity" className="text-xs" style={{ color: "var(--cl-text-muted)" }}>
          View all activity &rarr;
        </Link>
      </div>
    </div>
  );
}

function BucketTooltip({
  bucket,
  pos,
}: {
  bucket: ActivityTimelineBucket;
  pos: { x: number; y: number };
}) {
  const startTime = new Date(bucket.start);
  const endTime = new Date(startTime.getTime() + BUCKET_MS);
  const fmt = (d: Date) =>
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });

  const tier = riskTierFromScore(bucket.peakRisk);
  const activeCats = ALL_CATEGORIES.filter((c) => bucket.counts[c] > 0);
  const maxCatCount = Math.max(...activeCats.map((c) => bucket.counts[c]), 1);

  const tooltipW = 200;
  let left = pos.x - tooltipW / 2;
  left = Math.max(4, left);
  const top = pos.y - 12;

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
    </div>
  );
}
