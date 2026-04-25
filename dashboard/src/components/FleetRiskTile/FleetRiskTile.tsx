import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLiveApi } from "../../hooks/useLiveApi";
import { toolNamespace } from "../../lib/eventFormat";
import type {
  EntryResponse,
  FleetActivityResponse,
  FleetRiskIndexResponse,
} from "../../lib/types";
import type { RangeOption } from "../fleetheader/utils";
import {
  bucketCountsByTier,
  clampTooltipX,
  CRIT_THRESHOLD,
  makeTimeToX,
  tierStackedPaths,
  yForCount,
} from "./utils";
import { buildDayTicks, buildHourTicks, cullLabelsForWidth } from "../FleetActivityChart/utils";

interface Props {
  range: RangeOption;
  selectedDate: string | null;
}

// ── Layout constants (spec §6.2-§6.5) ─────────────────────────
const PLOT_LEFT = 20; // gutter for left-axis labels
const PLOT_WIDTH = 400;
const VIEW_WIDTH = PLOT_LEFT + PLOT_WIDTH; // 420
const SPARK_H = 100;
const SPARK_GAP = 20; // between sparkline and tape
const TAPE_H = 100; // lanes only
const AXIS_H = 40; // shared x-axis below the tape
const VIEW_H = SPARK_H + SPARK_GAP + TAPE_H + AXIS_H; // 260

const CRIT_LANE_Y = 32; // inside tape-g
const HIGH_LANE_Y = 72;
const TAPE_G_OFFSET = SPARK_H + SPARK_GAP; // 120
const NOW_LINE_INSET = 4;
const TOOLTIP_W = 220;

// ── Tier color tokens ────────────────────────────────────────
// 4-tier system-wide vocabulary. The chart's HIGH band uses HIGH_COLOR
// (salmon) — same token as the tape HIGH lane below — for cross-component
// color parity. The chart's MEDIUM band (amber) and LOW band (green) have no
// tape equivalent (tape only surfaces score >= 50).
const CRIT_COLOR = "var(--cl-risk-critical)";
const HIGH_COLOR = "var(--cl-risk-high)";
const MEDIUM_COLOR = "var(--cl-risk-medium)";
const LOW_COLOR = "var(--cl-risk-low)";
const ACCENT = "var(--cl-accent)";
const TEXT_MUTED = "var(--cl-text-muted)";
const TEXT_SUBDUED = "var(--cl-text-subdued)";
const TEXT_PRIMARY = "var(--cl-text-primary)";
const TEXT_SECONDARY = "var(--cl-text-secondary)";

function parseRangeMs(range: RangeOption): number {
  const m = range.match(/^(\d+)h$/);
  if (m) return Number(m[1]) * 3_600_000;
  const d = range.match(/^(\d+)d$/);
  if (d) return Number(d[1]) * 86_400_000;
  return 24 * 3_600_000;
}

function dotRadius(score: number): number {
  const r = 2.5 + ((score - 50) / 38) * 3.5;
  return Math.max(2.5, Math.min(6.0, r));
}

function heroCurrentColor(current: number): string {
  if (current >= 75) return CRIT_COLOR;
  if (current >= 50) return HIGH_COLOR;
  return TEXT_PRIMARY;
}

export default function FleetRiskTile({ range, selectedDate }: Props) {
  const navigate = useNavigate();

  // Two useApi calls, both unconditional at the top of the component.
  // Handle loading/empty AFTER the hooks (per spec §6 — do not early-return
  // before hooks).
  const activityPath = useMemo(() => {
    const params = new URLSearchParams({ range });
    if (selectedDate) params.set("date", selectedDate);
    return `api/fleet-activity?${params}`;
  }, [range, selectedDate]);

  // Live: both endpoints are aggregates that move on every entry, so the
  // default unfiltered useLiveApi (debounced refetch on every SSE arrival) is
  // the right shape — same return type as useApi, no other refactor.
  const { data: activity } = useLiveApi<FleetActivityResponse>(activityPath);
  const { data: index } = useLiveApi<FleetRiskIndexResponse>("api/fleet-risk-index");

  const isToday = selectedDate === null;

  // ── Time window for sparkline + tape ────────────────────────
  const nowMs = Date.now();
  const startMs = useMemo(
    () => (activity ? Date.parse(activity.startTime) : nowMs - parseRangeMs(range)),
    [activity, nowMs, range],
  );
  const endMs = useMemo(
    () => (activity ? Date.parse(activity.endTime) : nowMs),
    [activity, nowMs],
  );

  const timeToXLocal = useMemo(
    () => makeTimeToX(startMs, endMs, PLOT_WIDTH),
    [startMs, endMs],
  );
  const timeToX = useCallback((ms: number) => PLOT_LEFT + timeToXLocal(ms), [timeToXLocal]);

  // ── Sparkline buckets — 4-tier counts per hour (volume-area spec) ─
  const buckets = useMemo(() => {
    const bucketCount = range === "7d" ? 7 : 24;
    return bucketCountsByTier({
      entries: activity?.entries ?? [],
      startMs,
      endMs,
      bucketCount,
    });
  }, [activity, range, startMs, endMs]);

  // Floor the y-scale at 5 so a tiny-fleet day with one decision doesn't
  // over-zoom into a chart-filling stack.
  const maxVolume = useMemo(
    () => Math.max(5, ...buckets.map((b) => b.total)),
    [buckets],
  );

  const stackedPaths = useMemo(
    () => tierStackedPaths({ buckets, maxVolume, timeToX, plotHeight: SPARK_H }),
    [buckets, maxVolume, timeToX],
  );

  const isEmpty = buckets.length > 0 && buckets.every((b) => b.total === 0);

  // ── Tape events (score >= 50) ───────────────────────────────
  const tapeEvents = useMemo(() => {
    const rows: {
      entry: EntryResponse;
      x: number;
      y: number;
      r: number;
      tier: "critical" | "high";
    }[] = [];
    for (const e of activity?.entries ?? []) {
      const s = e.riskScore ?? 0;
      if (s < 50) continue;
      const tier = s >= CRIT_THRESHOLD ? "critical" : "high";
      const y = tier === "critical" ? CRIT_LANE_Y : HIGH_LANE_Y;
      rows.push({
        entry: e,
        x: timeToX(Date.parse(e.timestamp)),
        y,
        r: dotRadius(s),
        tier,
      });
    }
    return rows;
  }, [activity, timeToX]);

  // ── Axis ticks (shared below the tape) ──────────────────────
  const axisTicks = useMemo(() => {
    if (range === "7d") return buildDayTicks(startMs, endMs);
    return buildHourTicks(startMs, endMs, range);
  }, [range, startMs, endMs]);
  const labelShown = useMemo(
    () => cullLabelsForWidth(axisTicks, timeToX),
    [axisTicks, timeToX],
  );

  // ── Now line ────────────────────────────────────────────────
  const nowX = VIEW_WIDTH - NOW_LINE_INSET;

  // ── Hero values (fall back to zero-state when endpoint pending) ─
  // Structural guard — tests occasionally mock useApi with a shape that
  // doesn't carry the expected numeric fields (e.g. an empty array).
  // Clamp to the zero-state so downstream SVG math never sees NaN.
  const hero: FleetRiskIndexResponse =
    index && typeof index === "object" && typeof (index as FleetRiskIndexResponse).current === "number"
      ? (index as FleetRiskIndexResponse)
      : { current: 0, baselineP50: 0, delta: 0, critCount: 0, highCount: 0, totalElevated: 0 };

  // ── Hover state ─────────────────────────────────────────────
  // Tape-dot tooltip (per-event, score-axis tape) and bucket tooltip
  // (per-hour, volume-axis chart) are independent overlays — both use
  // foreignObject + HTML, but they target separate hit zones.
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const hovered = tapeEvents.find(
    (ev) => (ev.entry.toolCallId ?? ev.entry.timestamp) === hoverKey,
  );

  const [hoverBucketIdx, setHoverBucketIdx] = useState<number | null>(null);
  // Clear bucket hover when the buckets array refreshes (SSE refetch). An
  // index pointing at a stale bucket would surface incorrect counts.
  useEffect(() => {
    setHoverBucketIdx(null);
  }, [buckets]);
  const hoveredBucket =
    hoverBucketIdx !== null && hoverBucketIdx < buckets.length
      ? buckets[hoverBucketIdx]
      : null;

  const onDotClick = useCallback(
    (entry: EntryResponse) => {
      if (!entry.sessionKey) return;
      navigate(`/session/${encodeURIComponent(entry.sessionKey)}`, {
        state: { highlightToolCallId: entry.toolCallId },
      });
    },
    [navigate],
  );

  return (
    <section
      data-cl-fleet-risk-tile
      className="cl-card"
      style={{
        padding: 14,
        height: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* ── Hero (spec §6.2) ───────────────────────────────────── */}
      <div
        data-cl-fleet-risk-hero
        style={{
          display: "flex",
          alignItems: "center",
          gap: 20,
          minHeight: 110,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: 2,
            minWidth: 100,
          }}
        >
          <span
            data-cl-fleet-risk-current
            style={{
              fontFamily: "var(--cl-font-mono)",
              fontSize: 72,
              fontWeight: 400,
              letterSpacing: "-2px",
              lineHeight: 0.9,
              fontVariantNumeric: "tabular-nums",
              color: heroCurrentColor(hero.current),
            }}
          >
            {hero.current}
          </span>
          <span
            style={{
              fontFamily: "var(--cl-font-mono)",
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: heroCurrentColor(hero.current),
            }}
          >
            FLEET RISK
          </span>
          <span
            style={{
              fontFamily: "var(--cl-font-mono)",
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: TEXT_SUBDUED,
            }}
          >
            INDEX
          </span>
        </div>
        <div
          style={{
            borderLeft: "1px solid var(--cl-border-subtle)",
            paddingLeft: 20,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: 6,
            flex: 1,
          }}
        >
          <span
            data-cl-fleet-risk-delta
            style={{
              fontFamily: "var(--cl-font-mono)",
              fontSize: 13,
              fontVariantNumeric: "tabular-nums",
              color: hero.delta > 0 ? HIGH_COLOR : TEXT_SECONDARY,
            }}
          >
            {hero.delta > 0 ? `+${hero.delta}` : hero.delta} vs 7d baseline
          </span>
          <span
            style={{
              fontFamily: "var(--cl-font-mono)",
              fontSize: 11,
              color: TEXT_SECONDARY,
            }}
          >
            {hero.critCount} crit · {hero.highCount} high today
          </span>
          <span
            style={{
              fontFamily: "var(--cl-font-mono)",
              fontSize: 10,
              color: TEXT_SUBDUED,
            }}
          >
            baseline = p50 score over last 7 days
          </span>
        </div>
      </div>

      <div
        style={{
          borderTop: "1px solid var(--cl-border)",
          margin: "14px 0",
        }}
      />

      {/* ── Combined SVG (spec §6.5) — sparkline + tape + shared NOW line ── */}
      <svg
        role="img"
        aria-label="Fleet risk sparkline and event tape"
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_H}`}
        width="100%"
        height={VIEW_H}
        style={{ overflow: "visible" }}
      >
        {/* Sparkline layer — 4-tier stacked volume area (volume-area spec).
            Render order low → medium → high → crit so crit paints on top
            whenever any critical decisions occurred. Y axis = volume, not
            score. Stroke top-line per band gives clean band separation
            without depending on adjacent fills. */}
        <g>
          {!isEmpty && (
            <>
              <path
                data-cl-fleet-risk-sparkline="low"
                d={stackedPaths.low}
                fill={LOW_COLOR}
                fillOpacity={0.85}
                stroke="none"
              />
              <path
                data-cl-fleet-risk-sparkline="medium"
                d={stackedPaths.medium}
                fill={MEDIUM_COLOR}
                fillOpacity={0.85}
                stroke="none"
              />
              <path
                data-cl-fleet-risk-sparkline="high"
                d={stackedPaths.high}
                fill={HIGH_COLOR}
                fillOpacity={0.85}
                stroke="none"
              />
              <path
                data-cl-fleet-risk-sparkline="critical"
                d={stackedPaths.critical}
                fill={CRIT_COLOR}
                fillOpacity={0.85}
                stroke="none"
              />
              <path
                data-cl-fleet-risk-sparkline-line="low"
                d={stackedPaths.lowTopLine}
                fill="none"
                stroke={LOW_COLOR}
                strokeWidth={1}
                strokeLinejoin="miter"
              />
              <path
                data-cl-fleet-risk-sparkline-line="medium"
                d={stackedPaths.mediumTopLine}
                fill="none"
                stroke={MEDIUM_COLOR}
                strokeWidth={1}
                strokeLinejoin="miter"
              />
              <path
                data-cl-fleet-risk-sparkline-line="high"
                d={stackedPaths.highTopLine}
                fill="none"
                stroke={HIGH_COLOR}
                strokeWidth={1}
                strokeLinejoin="miter"
              />
              <path
                data-cl-fleet-risk-sparkline-line="critical"
                d={stackedPaths.critTopLine}
                fill="none"
                stroke={CRIT_COLOR}
                strokeWidth={1}
                strokeLinejoin="miter"
              />
            </>
          )}

          {isEmpty && (
            <text
              data-cl-fleet-risk-empty
              x={VIEW_WIDTH / 2}
              y={SPARK_H / 2}
              textAnchor="middle"
              dominantBaseline="middle"
              fontFamily="var(--cl-font-mono)"
              fontSize={11}
              fill={TEXT_MUTED}
              style={{ textTransform: "uppercase", letterSpacing: "0.04em" }}
            >
              No fleet activity in last {range}
            </text>
          )}

          {/* Subtle dashed marker at the hovered bucket's midpoint — anchors
              the tooltip to its column visually. */}
          {hoveredBucket && (
            <line
              data-cl-fleet-risk-bucket-marker
              x1={timeToX((hoveredBucket.startMs + hoveredBucket.endMs) / 2)}
              x2={timeToX((hoveredBucket.startMs + hoveredBucket.endMs) / 2)}
              y1={0}
              y2={SPARK_H}
              stroke="rgba(255,255,255,0.18)"
              strokeWidth={1}
              strokeDasharray="2 3"
            />
          )}

          {/* Per-bucket invisible hit area for hover tooltip. Suppressed in
              empty state — tooltip would surface zeros across the board. */}
          {!isEmpty &&
            buckets.map((b, i) => {
              const x = timeToX(b.startMs);
              const w = Math.max(1, timeToX(b.endMs) - x);
              return (
                <rect
                  key={`bh-${b.startMs}`}
                  data-cl-fleet-risk-bucket-hover={i}
                  x={x}
                  y={0}
                  width={w}
                  height={SPARK_H}
                  fill="transparent"
                  pointerEvents="all"
                  style={{ cursor: "crosshair" }}
                  onMouseEnter={() => setHoverBucketIdx(i)}
                  onMouseLeave={() => setHoverBucketIdx(null)}
                />
              );
            })}

          {/* NOW dot at top-of-stack (volume-area spec). Color = worst
              present tier of the last bucket. Hidden when the last bucket
              has no decisions (empty bucket → no signal to surface). */}
          {isToday &&
            buckets.length > 0 &&
            (() => {
              const last = buckets[buckets.length - 1];
              if (last.total === 0) return null;
              const lastX = timeToX((last.startMs + last.endMs) / 2);
              const lastY = yForCount(last.total, maxVolume, SPARK_H);
              const dotColor =
                last.counts.critical > 0
                  ? CRIT_COLOR
                  : last.counts.high > 0
                    ? HIGH_COLOR
                    : last.counts.medium > 0
                      ? MEDIUM_COLOR
                      : LOW_COLOR;
              return (
                <circle
                  data-cl-fleet-risk-now-dot
                  cx={lastX}
                  cy={lastY}
                  r={4}
                  fill={dotColor}
                  stroke="var(--cl-bg)"
                  strokeWidth={2}
                />
              );
            })()}
        </g>

        {/* Tape layer ── translated down by 120 */}
        <g transform={`translate(0, ${TAPE_G_OFFSET})`}>
          {/* Lane rules */}
          <line
            x1={PLOT_LEFT}
            x2={PLOT_LEFT + PLOT_WIDTH}
            y1={CRIT_LANE_Y}
            y2={CRIT_LANE_Y}
            stroke="rgba(255,255,255,0.05)"
            strokeWidth={0.5}
          />
          <line
            x1={PLOT_LEFT}
            x2={PLOT_LEFT + PLOT_WIDTH}
            y1={HIGH_LANE_Y}
            y2={HIGH_LANE_Y}
            stroke="rgba(255,255,255,0.05)"
            strokeWidth={0.5}
          />
          {/* Lane labels */}
          <text
            x={PLOT_LEFT - 8}
            y={CRIT_LANE_Y + 3}
            textAnchor="end"
            fontFamily="var(--cl-font-mono)"
            fontSize={10}
            fill={CRIT_COLOR}
            style={{ textTransform: "uppercase" }}
          >
            CRIT
          </text>
          <text
            x={PLOT_LEFT - 8}
            y={HIGH_LANE_Y + 3}
            textAnchor="end"
            fontFamily="var(--cl-font-mono)"
            fontSize={10}
            fill={HIGH_COLOR}
            style={{ textTransform: "uppercase" }}
          >
            HIGH
          </text>

          {/* Event dots */}
          {tapeEvents.map((ev) => {
            const key = ev.entry.toolCallId ?? ev.entry.timestamp;
            return (
              <g
                key={key}
                data-cl-fleet-risk-tape-dot={key}
                data-cl-tier={ev.tier}
                onClick={() => onDotClick(ev.entry)}
                onMouseEnter={() => setHoverKey(key)}
                onMouseLeave={() => setHoverKey(null)}
                style={{ cursor: ev.entry.sessionKey ? "pointer" : "default" }}
              >
                {ev.tier === "critical" ? (
                  <>
                    <circle cx={ev.x} cy={ev.y} r={ev.r + 3} fill={CRIT_COLOR} fillOpacity={0.18} />
                    <circle cx={ev.x} cy={ev.y} r={ev.r} fill={CRIT_COLOR} />
                    <circle cx={ev.x} cy={ev.y} r={ev.r - 1.5} fill="var(--cl-surface)" />
                    <circle cx={ev.x} cy={ev.y} r={ev.r - 2.5} fill={CRIT_COLOR} />
                  </>
                ) : (
                  <>
                    <circle cx={ev.x} cy={ev.y} r={ev.r + 2} fill={HIGH_COLOR} fillOpacity={0.15} />
                    <circle cx={ev.x} cy={ev.y} r={ev.r} fill={HIGH_COLOR} />
                  </>
                )}
              </g>
            );
          })}

          {/* Shared X-axis (§6.4) — below the lanes, inside the tape-g */}
          <line
            x1={PLOT_LEFT}
            x2={PLOT_LEFT + PLOT_WIDTH}
            y1={TAPE_H + 8}
            y2={TAPE_H + 8}
            stroke="rgba(255,255,255,0.05)"
            strokeWidth={0.5}
          />
          {axisTicks.map((t) => {
            if (!labelShown.has(t.ms)) return null;
            return (
              <text
                key={`ax-${t.ms}`}
                x={timeToX(t.ms)}
                y={TAPE_H + 28}
                textAnchor="middle"
                fontFamily="var(--cl-font-mono)"
                fontSize={10}
                fill={TEXT_MUTED}
              >
                {t.label}
              </text>
            );
          })}
        </g>

        {/* NOW line — single element at SVG root, spans sparkline + tape (spec §6.5) */}
        {isToday && (
          <line
            data-cl-fleet-risk-now-line
            x1={nowX}
            x2={nowX}
            y1={0}
            y2={VIEW_H - AXIS_H}
            stroke={ACCENT}
            strokeWidth={1.5}
            strokeOpacity={0.7}
            style={{ filter: `drop-shadow(0 0 3px ${ACCENT})` }}
          />
        )}

        {/* Hover tooltip — foreignObject + HTML body so the text can
            auto-size, wrap, and pad without clipping at SVG coords. X is
            clamped via clampTooltipX so dots near NOW don't push it
            outside the viewBox. pointer-events: none prevents hover
            flicker when the tooltip overlaps its own dot. */}
        {hovered && (
          <foreignObject
            data-cl-risk-tooltip
            x={clampTooltipX(hovered.x, VIEW_WIDTH, TOOLTIP_W)}
            y={
              TAPE_G_OFFSET +
              hovered.y +
              (hovered.y < TAPE_H / 2 ? 10 : -48)
            }
            width={TOOLTIP_W}
            height={40}
            style={{ overflow: "visible", pointerEvents: "none" }}
          >
            <div
              style={{
                background: "var(--cl-elevated)",
                border: "1px solid var(--cl-border)",
                borderRadius: 4,
                padding: "6px 10px",
                fontFamily: "var(--cl-font-mono)",
                fontSize: 10,
                color: TEXT_PRIMARY,
                lineHeight: 1.4,
                whiteSpace: "nowrap",
              }}
            >
              <div>
                <span style={{ color: TEXT_PRIMARY, fontWeight: 600 }}>
                  {hovered.entry.agentId ?? "default"}
                </span>
                <span style={{ color: TEXT_SUBDUED }}> · </span>
                <span style={{ color: TEXT_SECONDARY }}>
                  {toolNamespace(hovered.entry)}
                </span>
              </div>
              <div style={{ color: TEXT_MUTED }}>
                {hovered.entry.riskScore ?? 0} ·{" "}
                {new Date(hovered.entry.timestamp).toLocaleTimeString()}
              </div>
            </div>
          </foreignObject>
        )}

        {/* Per-bucket tooltip (volume-area spec §6) — surfaces the 4-tier
            breakdown for the hovered hour. All four tier rows render even
            when zero, so the breakdown reads structurally without scanning
            for missing rows. */}
        {hoveredBucket && (() => {
          const midX = timeToX((hoveredBucket.startMs + hoveredBucket.endMs) / 2);
          const fmtTime = (ms: number) =>
            new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          const tierRow = (
            color: string,
            count: number,
            label: string,
          ) => (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span
                aria-hidden="true"
                style={{
                  color,
                  fontWeight: 700,
                  width: 8,
                  textAlign: "center",
                }}
              >
                •
              </span>
              <span style={{ color: TEXT_PRIMARY }}>{count}</span>
              <span style={{ color: TEXT_SECONDARY }}>{label}</span>
            </div>
          );
          return (
            <foreignObject
              data-cl-fleet-risk-bucket-tooltip
              x={clampTooltipX(midX, VIEW_WIDTH, TOOLTIP_W)}
              y={4}
              width={TOOLTIP_W}
              height={92}
              style={{ overflow: "visible", pointerEvents: "none" }}
            >
              <div
                style={{
                  background: "var(--cl-elevated)",
                  border: "1px solid var(--cl-border)",
                  borderRadius: 4,
                  padding: "6px 10px",
                  fontFamily: "var(--cl-font-mono)",
                  fontSize: 11,
                  color: TEXT_PRIMARY,
                  lineHeight: 1.45,
                  whiteSpace: "nowrap",
                }}
              >
                <div style={{ color: TEXT_SECONDARY, marginBottom: 2 }}>
                  <span style={{ color: TEXT_PRIMARY, fontWeight: 600 }}>
                    {fmtTime(hoveredBucket.startMs)}–{fmtTime(hoveredBucket.endMs)}
                  </span>
                  <span style={{ color: TEXT_SUBDUED }}> · </span>
                  <span style={{ color: TEXT_PRIMARY }}>{hoveredBucket.total}</span>{" "}
                  actions
                </div>
                {tierRow(CRIT_COLOR, hoveredBucket.counts.critical, "crit")}
                {tierRow(HIGH_COLOR, hoveredBucket.counts.high, "high")}
                {tierRow(MEDIUM_COLOR, hoveredBucket.counts.medium, "medium")}
                {tierRow(LOW_COLOR, hoveredBucket.counts.low, "low")}
              </div>
            </foreignObject>
          );
        })()}
      </svg>

      {/* ── Legend footer (spec §6.7) ───────────────────────────── */}
      <div
        data-cl-fleet-risk-legend
        className="flex items-center"
        style={{
          gap: 12,
          marginTop: "auto",
          paddingTop: 8,
          borderTop: "1px solid var(--cl-border-subtle)",
        }}
      >
        <span
          className="flex items-center"
          style={{
            gap: 6,
            fontFamily: "var(--cl-font-mono)",
            fontSize: 10,
            color: TEXT_MUTED,
            textTransform: "uppercase",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              backgroundColor: HIGH_COLOR,
            }}
          />
          high
        </span>
        <span
          className="flex items-center"
          style={{
            gap: 6,
            fontFamily: "var(--cl-font-mono)",
            fontSize: 10,
            color: TEXT_MUTED,
            textTransform: "uppercase",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              border: `1.5px solid ${CRIT_COLOR}`,
            }}
          />
          critical
        </span>
        <span
          style={{
            marginLeft: "auto",
            fontFamily: "var(--cl-font-mono)",
            fontSize: 10,
            color: TEXT_SUBDUED,
          }}
        >
          {hero.totalElevated} · today
        </span>
      </div>
    </section>
  );
}
