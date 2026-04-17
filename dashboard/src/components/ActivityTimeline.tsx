import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { useSSE } from "../hooks/useSSE";
import type {
  SessionTimelineResponse,
  TimelineSession,
  SessionSegment,
  ActivityCategory,
  EntryResponse,
} from "../lib/types";
import { riskTierFromScore, riskColorRaw } from "../lib/utils";
import GradientAvatar from "./GradientAvatar";
import LiveIndicator from "./LiveIndicator";
import type { RangeOption } from "./fleetheader/utils";

interface Props {
  isToday: boolean;
  selectedDate: string | null;
  /** Owned by Agents.tsx so the FleetHeader pill group can drive both. */
  range: RangeOption;
  onRangeChange: (next: RangeOption) => void;
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

const ROW_HEIGHT = 40;
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

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

function fmtDuration(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export default function ActivityTimeline({ isToday, selectedDate, range }: Props) {
  const navigate = useNavigate();

  const apiPath = useMemo(() => {
    const params = new URLSearchParams({ range });
    if (selectedDate) params.set("date", selectedDate);
    return `api/session-timeline?${params}`;
  }, [selectedDate, range]);

  const { data: apiData, loading } = useApi<SessionTimelineResponse>(apiPath);

  // Mutable state for SSE updates
  const [liveSessions, setLiveSessions] = useState<TimelineSession[]>([]);
  const [liveAgents, setLiveAgents] = useState<string[]>([]);
  const [liveTotalActions, setLiveTotalActions] = useState(0);
  const [liveStartTime, setLiveStartTime] = useState("");
  const [liveEndTime, setLiveEndTime] = useState("");
  const [pulseKey, setPulseKey] = useState(0);

  const [hoveredSession, setHoveredSession] = useState<TimelineSession | null>(null);
  const [hoveredPos, setHoveredPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [hoveredAgent, setHoveredAgent] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Seed live state from API response
  useEffect(() => {
    if (apiData) {
      setLiveSessions(apiData.sessions);
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
        const sessionKey = entry.sessionKey ?? "unknown";
        const category = (entry.category ?? "exploring") as ActivityCategory;
        const risk = entry.riskScore ?? 0;
        const timestamp = entry.timestamp;
        const isBlocked =
          entry.effectiveDecision === "block" || entry.effectiveDecision === "denied";

        setLiveSessions((prev) => {
          const existing = prev.find(
            (s) => s.sessionKey === sessionKey && s.agentId === agentId,
          );
          if (existing) {
            return prev.map((s) => {
              if (s.sessionKey !== sessionKey || s.agentId !== agentId) return s;
              const newEnd = timestamp > s.endTime ? timestamp : s.endTime;
              const lastSeg = s.segments[s.segments.length - 1];
              let newSegments: SessionSegment[];
              if (lastSeg && lastSeg.category === category) {
                newSegments = [
                  ...s.segments.slice(0, -1),
                  { ...lastSeg, endTime: timestamp, actionCount: (lastSeg.actionCount ?? 1) + 1 },
                ];
              } else {
                newSegments = [
                  ...s.segments,
                  { category, startTime: timestamp, endTime: timestamp, actionCount: 1 },
                ];
              }
              return {
                ...s,
                endTime: newEnd,
                segments: newSegments,
                actionCount: s.actionCount + 1,
                avgRisk: Math.round(
                  (s.avgRisk * s.actionCount + risk) / (s.actionCount + 1),
                ),
                peakRisk: Math.max(s.peakRisk, risk),
                blockedCount: s.blockedCount + (isBlocked ? 1 : 0),
                isActive: true,
              };
            });
          }
          return [
            ...prev,
            {
              sessionKey,
              agentId,
              startTime: timestamp,
              endTime: timestamp,
              segments: [{ category, startTime: timestamp, endTime: timestamp, actionCount: 1 }],
              actionCount: 1,
              avgRisk: risk,
              peakRisk: risk,
              blockedCount: isBlocked ? 1 : 0,
              isActive: true,
            },
          ];
        });

        setLiveAgents((prev) => (prev.includes(agentId) ? prev : [...prev, agentId]));
        setLiveTotalActions((prev) => prev + 1);

        // Expand time range if needed
        setLiveStartTime((prev) => (!prev || timestamp < prev ? timestamp : prev));
        setLiveEndTime((prev) => (!prev || timestamp > prev ? timestamp : prev));

        setPulseKey((k) => k + 1);
      },
      [isToday],
    ),
  );

  // Use live state (seeded from API, updated by SSE)
  const agents = liveAgents;
  const sessions = liveSessions;
  const totalActions = liveTotalActions;
  const startTime = liveStartTime;
  const endTime = liveEndTime;

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
      <div>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <span className="font-display text-sm font-medium" style={{ color: "var(--cl-text-secondary)" }}>
            Fleet Activity
          </span>
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

  // Per-agent totals (re-sort by total desc)
  const agentTotals = new Map<string, number>();
  for (const s of sessions) {
    agentTotals.set(s.agentId, (agentTotals.get(s.agentId) ?? 0) + s.actionCount);
  }
  const sortedAgents = [...agents].sort(
    (a, b) => (agentTotals.get(b) ?? 0) - (agentTotals.get(a) ?? 0),
  );

  // SVG dimensions
  const chartWidth = measuredWidth;
  const swimlaneWidth = chartWidth - LABEL_WIDTH - ACTION_COUNT_WIDTH;
  const chartHeight = PAD_TOP + sortedAgents.length * ROW_HEIGHT + TIME_AXIS_HEIGHT;

  const timeToX = (ms: number) => LABEL_WIDTH + ((ms - startMs) / spanMs) * swimlaneWidth;

  // Hour ticks (or 12h ticks for 7-day view, so we don't get 168 labels).
  const tickInterval =
    range === "7d"
      ? 12 * 3_600_000
      : range === "1h" || range === "3h"
        ? 1_800_000
        : 3_600_000;
  const hourTicks: { ms: number; label: string }[] = [];
  const firstTick = Math.ceil(startMs / tickInterval) * tickInterval;
  for (let t = firstTick; t <= endMs; t += tickInterval) {
    hourTicks.push({ ms: t, label: fmtHour(t) });
  }

  const nowX = isToday ? timeToX(Date.now()) : null;

  const handleSessionHover = (
    session: TimelineSession | null,
    event?: React.MouseEvent,
  ) => {
    setHoveredSession(session);
    if (session && event && wrapperRef.current) {
      const rect = wrapperRef.current.getBoundingClientRect();
      setHoveredPos({ x: event.clientX - rect.left, y: event.clientY - rect.top });
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
        <span className="flex items-center gap-3 flex-wrap">
          {/* Dot risk legend */}
          <span className="flex items-center gap-1">
            <span className="inline-block rounded-full" style={{ width: 8, height: 8, backgroundColor: "var(--cl-risk-low)" }} />
            <span className="font-mono text-[10px]" style={{ color: "var(--cl-text-secondary)" }}>low</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block rounded-full" style={{ width: 8, height: 8, backgroundColor: "var(--cl-risk-medium)" }} />
            <span className="font-mono text-[10px]" style={{ color: "var(--cl-text-secondary)" }}>med</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block rounded-full" style={{ width: 8, height: 8, backgroundColor: "var(--cl-risk-high)" }} />
            <span className="font-mono text-[10px]" style={{ color: "var(--cl-text-secondary)" }}>high</span>
          </span>
        </span>
      </div>

      {/* Chart */}
      <div ref={containerRef}>
      <svg
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        className="w-full overflow-visible"
      >
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

              {/* Session dots */}
              {sessions
                .filter((s) => s.agentId === agentId)
                .map((session) => {
                  const sStartMs = new Date(session.startTime).getTime();
                  const cx = timeToX(sStartMs);
                  const cy = rowY + ROW_HEIGHT / 2;

                  // Dot size by action count
                  const r = session.actionCount <= 5 ? 4
                          : session.actionCount <= 20 ? 6
                          : 8;

                  // Dot color by risk tier
                  const tier = riskTierFromScore(session.avgRisk);
                  const color = riskColorRaw(tier);

                  return (
                    <g
                      key={session.sessionKey}
                      style={{ cursor: "pointer" }}
                      onClick={() => navigate(`/session/${encodeURIComponent(session.sessionKey)}`)}
                      onMouseEnter={(e) => handleSessionHover(session, e)}
                      onMouseMove={(e) => handleSessionHover(session, e)}
                      onMouseLeave={() => handleSessionHover(null)}
                    >
                      <circle cx={cx} cy={cy} r={r} fill={color} opacity={0.85} />

                      {/* Active session pulse ring */}
                      {session.isActive && (
                        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={1.5}>
                          <animate attributeName="r" from={String(r)} to={String(r + 8)} dur="2s" repeatCount="indefinite" />
                          <animate attributeName="opacity" from="0.6" to="0" dur="2s" repeatCount="indefinite" />
                        </circle>
                      )}

                      {/* Blocked indicator — red ring */}
                      {session.blockedCount > 0 && (
                        <circle cx={cx} cy={cy} r={r + 2} fill="none" stroke="var(--cl-risk-high)" strokeWidth={1.5} />
                      )}

                      {/* Invisible hit area */}
                      <circle cx={cx} cy={cy} r={12} fill="transparent" />
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
                      style={{ fill: "var(--cl-text-muted)", fontSize: 10 }}
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
                    <text
                      x={nowX}
                      y={PAD_TOP - 2}
                      textAnchor="middle"
                      className="label-mono"
                      style={{ fill: "var(--cl-accent)", fontSize: 10 }}
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
      {hoveredSession && (
        <SessionTooltip session={hoveredSession} pos={hoveredPos} wrapperRef={wrapperRef} />
      )}
    </div>
  );
}

function SessionTooltip({
  session,
  pos,
  wrapperRef,
}: {
  session: TimelineSession;
  pos: { x: number; y: number };
  wrapperRef: React.RefObject<HTMLDivElement | null>;
}) {
  const tier = riskTierFromScore(session.peakRisk);
  const duration = fmtDuration(session.startTime, session.endTime);

  // Category breakdown from segments (action-count-based)
  const catCounts = new Map<ActivityCategory, number>();
  for (const seg of session.segments) {
    catCounts.set(seg.category, (catCounts.get(seg.category) ?? 0) + (seg.actionCount ?? 1));
  }
  const totalCount = [...catCounts.values()].reduce((a, b) => a + b, 0) || 1;
  const breakdown = [...catCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([cat, count]) => ({ cat, pct: Math.round((count / totalCount) * 100) }));

  const tooltipW = 230;
  const wrapperW = wrapperRef.current?.offsetWidth ?? 800;
  let left = pos.x - tooltipW / 2;
  left = Math.max(4, Math.min(left, wrapperW - tooltipW - 4));
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
        <GradientAvatar agentId={session.agentId} size="sm" />
        <span style={{ color: "var(--cl-text-primary)", fontWeight: 600, fontSize: 12 }}>
          {session.agentId}
        </span>
      </div>

      {/* Time range */}
      <div style={{ color: "var(--cl-text-muted)", marginBottom: 2, fontWeight: 600 }}>
        {fmtTime(session.startTime)} – {fmtTime(session.endTime)}
      </div>

      {/* Duration + actions */}
      <div style={{ color: "var(--cl-text-secondary)", marginBottom: 6, fontSize: 10 }}>
        {duration} · {session.actionCount} action{session.actionCount !== 1 ? "s" : ""}
      </div>

      {/* Category breakdown */}
      {breakdown.map(({ cat, pct }) => (
        <div key={cat} className="flex items-center gap-2 mb-0.5">
          <span
            className="inline-block rounded-sm"
            style={{
              width: 8,
              height: 8,
              backgroundColor: CATEGORY_COLORS[cat],
              flexShrink: 0,
            }}
          />
          <span style={{ color: "var(--cl-text-secondary)", fontSize: 10, flex: 1 }}>
            {CATEGORY_LABELS[cat]}
          </span>
          <span style={{ color: "var(--cl-text-muted)", fontSize: 10 }}>
            {pct}%
          </span>
        </div>
      ))}

      {/* Risk */}
      {session.peakRisk > 0 && (
        <div className="mt-2 flex items-center gap-1.5">
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: riskColorRaw(tier) }}
          />
          <span style={{ color: riskColorRaw(tier), fontSize: 10 }}>
            risk: {tier.toUpperCase()}
          </span>
        </div>
      )}

      {/* Blocked count */}
      {session.blockedCount > 0 && (
        <div className="mt-1" style={{ color: "var(--cl-risk-high)", fontSize: 10 }}>
          {session.blockedCount} blocked
        </div>
      )}

      {/* Click hint */}
      <div className="mt-1" style={{ color: "var(--cl-accent)", fontSize: 9 }}>
        Click to view session →
      </div>
    </div>
  );
}
