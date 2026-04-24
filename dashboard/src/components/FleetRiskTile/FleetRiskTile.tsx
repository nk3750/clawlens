import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApi } from "../../hooks/useApi";
import type {
  EntryResponse,
  FleetActivityResponse,
  FleetRiskIndexResponse,
} from "../../lib/types";
import type { RangeOption } from "../fleetheader/utils";
import {
  bucketEntriesByHour,
  CRIT_THRESHOLD,
  makeTimeToX,
  steppedAreaPath,
  yForScore,
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

// ── Tier color tokens ────────────────────────────────────────
const CRIT_COLOR = "var(--cl-risk-critical)";
const HIGH_COLOR = "var(--cl-risk-high)";
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

  const { data: activity } = useApi<FleetActivityResponse>(activityPath);
  const { data: index } = useApi<FleetRiskIndexResponse>("api/fleet-risk-index");

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

  // ── Sparkline buckets ───────────────────────────────────────
  const buckets = useMemo(() => {
    const bucketCount = range === "7d" ? 7 : 24;
    return bucketEntriesByHour({
      entries: activity?.entries ?? [],
      startMs,
      endMs,
      bucketCount,
    });
  }, [activity, range, startMs, endMs]);

  const sparkPath = useMemo(
    () => steppedAreaPath({ buckets, timeToX, plotHeight: SPARK_H }),
    [buckets, timeToX],
  );

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

  const critY = yForScore(CRIT_THRESHOLD, SPARK_H);
  const baselineY = yForScore(hero.baselineP50, SPARK_H);

  // ── Hover tooltip (spec §6.6) ───────────────────────────────
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const hovered = tapeEvents.find(
    (ev) => (ev.entry.toolCallId ?? ev.entry.timestamp) === hoverKey,
  );

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
    <section data-cl-fleet-risk-tile className="cl-card" style={{ padding: 14 }}>
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
            {hero.delta >= 0 ? `+${hero.delta}` : hero.delta} vs 24h baseline
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
            baseline = p50 of last 7 days
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
        <defs>
          <clipPath id="cl-frt-low-clip">
            <rect x={PLOT_LEFT} y={critY} width={PLOT_WIDTH} height={SPARK_H - critY} />
          </clipPath>
          <clipPath id="cl-frt-crit-clip">
            <rect x={PLOT_LEFT} y={0} width={PLOT_WIDTH} height={critY} />
          </clipPath>
        </defs>

        {/* Sparkline layer ── y in [0, 100] */}
        <g>
          {/* Low-tier area (below y=75) */}
          <path
            data-cl-fleet-risk-sparkline="low"
            d={sparkPath}
            fill={HIGH_COLOR}
            fillOpacity={0.28}
            stroke={HIGH_COLOR}
            strokeWidth={1.5}
            clipPath="url(#cl-frt-low-clip)"
          />
          {/* Critical-tier area (above y=75 — hard clip at threshold) */}
          <path
            data-cl-fleet-risk-sparkline="crit"
            d={sparkPath}
            fill={CRIT_COLOR}
            fillOpacity={0.28}
            stroke={CRIT_COLOR}
            strokeWidth={1.5}
            clipPath="url(#cl-frt-crit-clip)"
          />

          {/* Critical threshold line + "75" label */}
          <line
            data-cl-fleet-risk-threshold-line
            x1={PLOT_LEFT}
            x2={PLOT_LEFT + PLOT_WIDTH}
            y1={critY}
            y2={critY}
            stroke={TEXT_SUBDUED}
            strokeDasharray="2 4"
            strokeWidth={0.5}
          />
          <text
            x={4}
            y={critY + 3}
            fontSize={10}
            fontFamily="var(--cl-font-mono)"
            fill={TEXT_SUBDUED}
          >
            75
          </text>

          {/* Baseline line + "{baselineP50}" label */}
          <line
            data-cl-fleet-risk-baseline-line
            x1={PLOT_LEFT}
            x2={PLOT_LEFT + PLOT_WIDTH}
            y1={baselineY}
            y2={baselineY}
            stroke={TEXT_MUTED}
            strokeDasharray="2 4"
            strokeWidth={1}
          />
          <text
            x={4}
            y={baselineY + 3}
            fontSize={10}
            fontFamily="var(--cl-font-mono)"
            fill={TEXT_MUTED}
          >
            {hero.baselineP50}
          </text>
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

        {/* Hover tooltip */}
        {hovered && (
          <g data-cl-risk-tooltip transform={`translate(${hovered.x}, ${TAPE_G_OFFSET + hovered.y})`}>
            <rect
              x={-90}
              y={hovered.y < TAPE_H / 2 ? 10 : -34}
              width={180}
              height={24}
              rx={4}
              fill="var(--cl-elevated)"
              stroke="var(--cl-border)"
            />
            <text
              x={0}
              y={hovered.y < TAPE_H / 2 ? 26 : -18}
              textAnchor="middle"
              fontFamily="var(--cl-font-mono)"
              fontSize={10}
              fill={TEXT_PRIMARY}
            >
              {(hovered.entry.agentId ?? "default")} · {hovered.entry.riskScore ?? 0} ·{" "}
              {new Date(hovered.entry.timestamp).toLocaleTimeString()}
            </text>
          </g>
        )}
      </svg>

      {/* ── Legend footer (spec §6.7) ───────────────────────────── */}
      <div
        data-cl-fleet-risk-legend
        className="flex items-center"
        style={{
          gap: 12,
          marginTop: 8,
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
          {hero.totalElevated} · 24h
        </span>
      </div>
    </section>
  );
}
