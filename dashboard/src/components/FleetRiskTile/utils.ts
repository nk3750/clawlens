// Pure math for FleetRiskTile.
// Spec: docs/product/homepage-bottom-row-spec.md §6.3, §6.5

import type { EntryResponse } from "../../lib/types";
export { makeTimeToX } from "../FleetActivityChart/utils";

/** Visual floor for sparkline Y axis — hours with no events don't collapse. */
export const SCORE_FLOOR = 30;
export const SCORE_TOP = 100;
/** Critical threshold — hard clip split for two-tone fill. */
export const CRIT_THRESHOLD = 75;

/** yForScore(s) = plotHeight * (1 - (max(s, 30) - 30) / 70)
 *  Inputs outside [30, 100] clamp into the plot range. */
export function yForScore(score: number, plotHeight: number): number {
  const clamped = Math.max(SCORE_FLOOR, Math.min(SCORE_TOP, score));
  return plotHeight * (1 - (clamped - SCORE_FLOOR) / (SCORE_TOP - SCORE_FLOOR));
}

export interface HourBucket {
  /** Max riskScore in the bucket (floored to SCORE_FLOOR). */
  max: number;
  /** Bucket start (inclusive). */
  startMs: number;
  /** Bucket end (exclusive). */
  endMs: number;
}

/** Contiguous, equal-width buckets covering [startMs, endMs]. Each bucket's
 *  `max` is the maximum riskScore of entries in [startMs, endMs), clamped up
 *  to SCORE_FLOOR for visual stability in empty hours. */
export function bucketEntriesByHour(opts: {
  entries: EntryResponse[];
  startMs: number;
  endMs: number;
  bucketCount: number;
}): HourBucket[] {
  const { entries, startMs, endMs, bucketCount } = opts;
  if (bucketCount <= 0 || endMs <= startMs) return [];

  const span = endMs - startMs;
  const buckets: HourBucket[] = [];
  for (let i = 0; i < bucketCount; i++) {
    const bStart = startMs + (i * span) / bucketCount;
    const bEnd = startMs + ((i + 1) * span) / bucketCount;
    buckets.push({ max: SCORE_FLOOR, startMs: bStart, endMs: bEnd });
  }

  for (const e of entries) {
    const t = new Date(e.timestamp).getTime();
    if (t < startMs || t >= endMs) continue;
    const idx = Math.min(
      bucketCount - 1,
      Math.floor(((t - startMs) / span) * bucketCount),
    );
    const s = e.riskScore ?? 0;
    if (s > buckets[idx].max) buckets[idx].max = s;
  }

  // Final floor pass — any bucket whose max somehow slipped below 30 (can't
  // happen with current init but defensive) gets clamped.
  for (const b of buckets) {
    if (b.max < SCORE_FLOOR) b.max = SCORE_FLOOR;
  }

  return buckets;
}

/** Midpoint-linear area path (closed polygon). One point per bucket at the
 *  midpoint x + max-score y; consecutive midpoints connect with straight
 *  diagonals (no stepped risers). Closes to `plotHeight` at the leftmost and
 *  rightmost midpoints so the polygon fills under the curve. */
export function midpointLinearAreaPath(opts: {
  buckets: HourBucket[];
  timeToX: (ms: number) => number;
  plotHeight: number;
}): string {
  const { buckets, timeToX, plotHeight } = opts;
  if (buckets.length === 0) return "";

  const pts: { x: number; y: number }[] = buckets.map((b) => ({
    x: timeToX((b.startMs + b.endMs) / 2),
    y: yForScore(b.max, plotHeight),
  }));

  const firstX = pts[0].x;
  const lastX = pts[pts.length - 1].x;

  const parts: string[] = [];
  parts.push(`M ${fmt(firstX)} ${fmt(plotHeight)}`);
  for (const p of pts) {
    parts.push(`L ${fmt(p.x)} ${fmt(p.y)}`);
  }
  parts.push(`L ${fmt(lastX)} ${fmt(plotHeight)}`);
  parts.push("Z");
  return parts.join(" ");
}

function fmt(n: number): string {
  // Keep SVG path strings lean + stable-hashable across renders.
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** Keep a tooltip inside the SVG regardless of which dot triggered it.
 *  Centers the tooltip on the dot by default, clamps so the left edge
 *  never goes below 0 and the right edge never exceeds svgWidth. */
export function clampTooltipX(
  dotX: number,
  svgWidth: number,
  tipWidth = 220,
): number {
  const centered = dotX - tipWidth / 2;
  return Math.max(0, Math.min(svgWidth - tipWidth, centered));
}
