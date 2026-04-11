import { useState, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import type { ActivityTimelineResponse, ActivityTimelineBucket, ActivityCategory } from "../lib/types";
import { riskTierFromScore, riskColorRaw } from "../lib/utils";

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

const ALL_CATEGORIES: ActivityCategory[] = ["exploring", "commands", "web", "comms", "changes", "data"];

const ROW_HEIGHT = 48;
const LABEL_WIDTH = 140;
const TIME_AXIS_HEIGHT = 24;
const LEGEND_HEIGHT = 28;
const PAD_TOP = 8;
const PAD_RIGHT = 16;

function fmtHour(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  const ampm = h >= 12 ? "pm" : "am";
  const h12 = h % 12 || 12;
  return `${h12}${ampm}`;
}

export default function ActivityTimeline({ isToday, selectedDate }: Props) {
  const apiPath = useMemo(() => {
    const params = new URLSearchParams({ bucketMinutes: "15" });
    if (selectedDate) params.set("date", selectedDate);
    return `api/activity-timeline?${params}`;
  }, [selectedDate]);

  const { data, loading } = useApi<ActivityTimelineResponse>(apiPath);
  const [hoveredBucket, setHoveredBucket] = useState<ActivityTimelineBucket | null>(null);
  const [hoveredPos, setHoveredPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [hoveredAgent, setHoveredAgent] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  if (loading && !data) {
    return (
      <div className="mt-8">
        <span className="label-mono" style={{ color: "var(--cl-text-muted)" }}>FLEET ACTIVITY</span>
        <p className="text-sm py-8 text-center" style={{ color: "var(--cl-text-muted)" }}>
          Loading...
        </p>
      </div>
    );
  }

  if (!data || data.totalActions === 0) {
    return (
      <div className="mt-8">
        <span className="label-mono" style={{ color: "var(--cl-text-muted)" }}>FLEET ACTIVITY</span>
        <p className="text-sm py-8 text-center" style={{ color: "var(--cl-text-muted)" }}>
          {isToday ? "No activity yet" : `No activity on this day`}
        </p>
        <div className="text-center">
          <Link to="/activity" className="text-xs" style={{ color: "var(--cl-text-muted)" }}>
            View all activity &rarr;
          </Link>
        </div>
      </div>
    );
  }

  const { agents, buckets, startTime, endTime, totalActions } = data;
  const startMs = new Date(startTime).getTime();
  const endMs = isToday ? Date.now() : new Date(endTime).getTime();
  const spanMs = endMs - startMs || 1;
  const bucketMs = 15 * 60_000;

  // Find max bucket total for opacity scaling
  const maxBucketTotal = Math.max(...buckets.map((b) => b.total), 1);

  // Index buckets by agentId:start for fast lookup
  const bucketIndex = new Map<string, ActivityTimelineBucket>();
  for (const b of buckets) {
    bucketIndex.set(`${b.agentId}:${b.start}`, b);
  }

  // Per-agent totals
  const agentTotals = new Map<string, number>();
  for (const b of buckets) {
    agentTotals.set(b.agentId, (agentTotals.get(b.agentId) ?? 0) + b.total);
  }

  // SVG dimensions
  const chartWidth = 800; // will be scaled via viewBox
  const swimlaneWidth = chartWidth - LABEL_WIDTH - PAD_RIGHT;
  const chartHeight = PAD_TOP + agents.length * ROW_HEIGHT + TIME_AXIS_HEIGHT + LEGEND_HEIGHT;

  // Time → x coordinate
  const timeToX = (ms: number) => LABEL_WIDTH + ((ms - startMs) / spanMs) * swimlaneWidth;
  const barWidth = Math.max(2, (bucketMs / spanMs) * swimlaneWidth - 1);

  // Hour tick marks
  const hourTicks: { ms: number; label: string }[] = [];
  const firstHour = Math.ceil(startMs / 3_600_000) * 3_600_000;
  for (let t = firstHour; t <= endMs; t += 3_600_000) {
    hourTicks.push({ ms: t, label: fmtHour(t) });
  }

  // NOW line position
  const nowX = isToday ? timeToX(Date.now()) : null;

  // Active categories (those with any data)
  const activeCategories = ALL_CATEGORIES.filter((cat) =>
    buckets.some((b) => b.counts[cat] > 0),
  );

  const handleBucketHover = (
    bucket: ActivityTimelineBucket | null,
    event?: React.MouseEvent,
  ) => {
    setHoveredBucket(bucket);
    if (bucket && event && wrapperRef.current) {
      const rect = wrapperRef.current.getBoundingClientRect();
      setHoveredPos({
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    }
  };

  return (
    <div className="mt-8" ref={wrapperRef} style={{ position: "relative" }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <span className="label-mono" style={{ color: "var(--cl-text-muted)" }}>
          FLEET ACTIVITY
        </span>
        <span className="font-mono text-xs" style={{ color: "var(--cl-text-secondary)" }}>
          {totalActions} {isToday ? "today" : "actions"}
        </span>
      </div>

      {/* Chart */}
      <svg
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        className="w-full overflow-visible"
        style={{ maxWidth: chartWidth }}
      >
        {/* Agent rows */}
        {agents.map((agentId, rowIdx) => {
          const rowY = PAD_TOP + rowIdx * ROW_HEIGHT;
          const total = agentTotals.get(agentId) ?? 0;
          const isDimmed = hoveredAgent !== null && hoveredAgent !== agentId;

          return (
            <g
              key={agentId}
              opacity={isDimmed ? 0.3 : 1}
              style={{ transition: "opacity 0.2s" }}
            >
              {/* Row background on hover */}
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
                y={rowY + 20}
                className="label-mono"
                style={{ fill: "var(--cl-text-primary)", fontSize: 11 }}
              >
                {agentId.length > 16 ? `${agentId.slice(0, 15)}\u2026` : agentId}
              </text>

              {/* Action count */}
              <text
                x={4}
                y={rowY + 34}
                className="label-mono"
                style={{ fill: "var(--cl-text-muted)", fontSize: 9 }}
              >
                {total} actions
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
                  const opacity = 0.3 + 0.7 * (bucket.total / maxBucketTotal);
                  const maxBarH = ROW_HEIGHT - 16;

                  // Stacked segments
                  let segY = rowY + ROW_HEIGHT - 8;
                  const segments: React.ReactElement[] = [];

                  for (const cat of ALL_CATEGORIES) {
                    const count = bucket.counts[cat];
                    if (count === 0) continue;
                    const segH = Math.max(2, (count / bucket.total) * maxBarH);
                    segY -= segH;
                    segments.push(
                      <rect
                        key={cat}
                        x={bx}
                        y={segY}
                        width={barWidth}
                        height={segH}
                        rx={1}
                        fill={CATEGORY_COLORS[cat]}
                        opacity={opacity}
                      />,
                    );
                  }

                  return (
                    <g
                      key={bucket.start}
                      onMouseEnter={(e) => handleBucketHover(bucket, e)}
                      onMouseMove={(e) => handleBucketHover(bucket, e)}
                      onMouseLeave={() => handleBucketHover(null)}
                      style={{ cursor: "default" }}
                    >
                      {segments}
                      {/* Invisible hit area */}
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
            </g>
          );
        })}

        {/* Time axis */}
        {(() => {
          const axisY = PAD_TOP + agents.length * ROW_HEIGHT + 4;
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

              {/* NOW line */}
              {nowX !== null && nowX >= LABEL_WIDTH && nowX <= LABEL_WIDTH + swimlaneWidth && (
                <>
                  <line
                    x1={nowX}
                    y1={PAD_TOP}
                    x2={nowX}
                    y2={axisY}
                    stroke="var(--cl-accent)"
                    strokeWidth={1}
                    strokeDasharray="3 3"
                    opacity={0.6}
                  />
                  <text
                    x={nowX}
                    y={axisY + 16}
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

        {/* Legend */}
        {(() => {
          const legendY = PAD_TOP + agents.length * ROW_HEIGHT + TIME_AXIS_HEIGHT + 4;
          let lx = LABEL_WIDTH;
          return activeCategories.map((cat) => {
            const x = lx;
            lx += 12 + CATEGORY_LABELS[cat].length * 6.5 + 16;
            return (
              <g key={cat}>
                <rect
                  x={x}
                  y={legendY}
                  width={8}
                  height={8}
                  rx={2}
                  fill={CATEGORY_COLORS[cat]}
                  opacity={0.8}
                />
                <text
                  x={x + 12}
                  y={legendY + 8}
                  className="label-mono"
                  style={{ fill: "var(--cl-text-muted)", fontSize: 9 }}
                >
                  {CATEGORY_LABELS[cat]}
                </text>
              </g>
            );
          });
        })()}
      </svg>

      {/* Tooltip */}
      {hoveredBucket && (
        <BucketTooltip bucket={hoveredBucket} pos={hoveredPos} />
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

function BucketTooltip({
  bucket,
  pos,
}: {
  bucket: ActivityTimelineBucket;
  pos: { x: number; y: number };
}) {
  const startTime = new Date(bucket.start);
  const endTime = new Date(startTime.getTime() + 15 * 60_000);
  const fmt = (d: Date) =>
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });

  const tier = riskTierFromScore(bucket.peakRisk);
  const activeCats = ALL_CATEGORIES.filter((c) => bucket.counts[c] > 0);

  // Position tooltip avoiding edge overflow
  const tooltipW = 180;
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
        borderRadius: 8,
        padding: "8px 12px",
        fontSize: 11,
        fontFamily: "var(--cl-font-mono, monospace)",
        boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
        pointerEvents: "none",
        zIndex: 10,
        opacity: 1,
        transition: "opacity 0.15s",
      }}
    >
      <div style={{ color: "var(--cl-text-primary)", fontWeight: 600, marginBottom: 2 }}>
        {bucket.agentId}
      </div>
      <div style={{ color: "var(--cl-text-muted)", marginBottom: 4 }}>
        {fmt(startTime)} – {fmt(endTime)}
      </div>
      {activeCats.map((cat) => (
        <div key={cat} className="flex items-center gap-1.5" style={{ color: "var(--cl-text-secondary)" }}>
          <span
            className="inline-block w-2 h-2 rounded-sm"
            style={{ backgroundColor: CATEGORY_COLORS[cat] }}
          />
          {CATEGORY_LABELS[cat]}: {bucket.counts[cat]}
        </div>
      ))}
      <div className="mt-1 flex items-center gap-1" style={{ color: riskColorRaw(tier) }}>
        peak risk: {bucket.peakRisk} {tier.toUpperCase()}
      </div>
    </div>
  );
}
