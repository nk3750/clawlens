// Pure math for FleetRiskTile.
// Spec: docs/product/homepage-bottom-row-spec.md §6.3, §6.5

import type { EntryResponse } from "../../lib/types";
export { makeTimeToX } from "../FleetActivityChart/utils";

/** Visual floor for sparkline Y axis — hours with no events don't collapse. */
export const SCORE_FLOOR = 30;
export const SCORE_TOP = 100;
/** High threshold — score ≥50 is the "high" tier (green→amber boundary). */
export const HIGH_THRESHOLD = 50;
/** Critical threshold — score ≥75 is the "crit" tier (amber→red boundary). */
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

// ─────────────────────────────────────────────────────────────
// Tier-stacked volume area (FleetRiskTile sparkline → 4-tier chart)
// Spec: docs/product/fleet-risk-tile-volume-area-spec.md
// ─────────────────────────────────────────────────────────────

export interface TierBucket {
  /** Bucket start (inclusive). */
  startMs: number;
  /** Bucket end (exclusive). */
  endMs: number;
  /** Decision counts per system-wide tier (matches riskTierFromScore + getEffectiveTier). */
  counts: { low: number; medium: number; high: number; critical: number };
  /** Sum of the four tier counts. Excludes entries that classified as undefined
   *  (allow-without-score and timeout-without-score). */
  total: number;
}

type TierKey = "low" | "medium" | "high" | "critical";

/** Mirror of src/dashboard/api.ts::getEffectiveTier — keep in lockstep when
 *  the backend helper changes. Precedence:
 *    1. entry.riskTier (when set to one of the 4 canonical labels).
 *    2. entry.decision === "block" → "critical".
 *    3. entry.decision === "approval_required" → "high".
 *    4. otherwise undefined (caller drops the entry from histograms). */
function classifyTier(entry: EntryResponse): TierKey | undefined {
  const tier = entry.riskTier;
  if (tier === "low" || tier === "medium" || tier === "high" || tier === "critical") {
    return tier;
  }
  if (entry.decision === "block") return "critical";
  if (entry.decision === "approval_required") return "high";
  return undefined;
}

/** Contiguous, equal-width buckets covering [startMs, endMs] with per-tier
 *  decision counts. Tier classification follows the system-wide convention
 *  used by getEffectiveTier (centralized in src/dashboard/api.ts). */
export function bucketCountsByTier(opts: {
  entries: EntryResponse[];
  startMs: number;
  endMs: number;
  bucketCount: number;
}): TierBucket[] {
  const { entries, startMs, endMs, bucketCount } = opts;
  if (bucketCount <= 0 || endMs <= startMs) return [];

  const span = endMs - startMs;
  const buckets: TierBucket[] = [];
  for (let i = 0; i < bucketCount; i++) {
    const bStart = startMs + (i * span) / bucketCount;
    const bEnd = startMs + ((i + 1) * span) / bucketCount;
    buckets.push({
      startMs: bStart,
      endMs: bEnd,
      counts: { low: 0, medium: 0, high: 0, critical: 0 },
      total: 0,
    });
  }

  for (const e of entries) {
    const t = new Date(e.timestamp).getTime();
    if (t < startMs || t >= endMs) continue;
    const tier = classifyTier(e);
    if (!tier) continue; // drop allow/timeout-without-score; not a low-tier signal
    const idx = Math.min(
      bucketCount - 1,
      Math.floor(((t - startMs) / span) * bucketCount),
    );
    buckets[idx].counts[tier] += 1;
    buckets[idx].total += 1;
  }

  return buckets;
}

/** Linear count→y mapping. count=0 → plotHeight (bottom). count=maxVolume → 0
 *  (top). Out-of-range counts clamp. maxVolume < 1 returns plotHeight to
 *  avoid div-by-zero / inverted ranges in degenerate windows. */
export function yForCount(
  count: number,
  maxVolume: number,
  plotHeight: number,
): number {
  if (maxVolume < 1) return plotHeight;
  const clamped = Math.max(0, Math.min(maxVolume, count));
  return plotHeight * (1 - clamped / maxVolume);
}

interface StackedPaths {
  low: string;
  medium: string;
  high: string;
  critical: string;
  lowTopLine: string;
  mediumTopLine: string;
  highTopLine: string;
  critTopLine: string;
}

/** Generate 4 closed-polygon path strings + 4 stroke-only top-line path
 *  strings for a tier-stacked volume area. Each polygon's top edge is the
 *  cumulative tier line (yLow, yMedium, yHigh, yCrit = total). The bottom
 *  edge is the previous tier's top line, or plotHeight for the low band.
 *
 *  Edge extension: leftmost top extends to timeToX(buckets[0].startMs) and
 *  rightmost top extends to timeToX(last.endMs) so the stack reaches the
 *  chart's visual edges instead of insetting at the first/last midpoint. */
export function tierStackedPaths(opts: {
  buckets: TierBucket[];
  maxVolume: number;
  timeToX: (ms: number) => number;
  plotHeight: number;
}): StackedPaths {
  const { buckets, maxVolume, timeToX, plotHeight } = opts;
  if (buckets.length === 0) {
    return {
      low: "",
      medium: "",
      high: "",
      critical: "",
      lowTopLine: "",
      mediumTopLine: "",
      highTopLine: "",
      critTopLine: "",
    };
  }

  const midX = buckets.map((b) => timeToX((b.startMs + b.endMs) / 2));
  const leftEdgeX = timeToX(buckets[0].startMs);
  const rightEdgeX = timeToX(buckets[buckets.length - 1].endMs);

  // Cumulative y per tier per bucket. Higher cumulative count → smaller y
  // (tier sits higher in the stack).
  const yLow = buckets.map((b) => yForCount(b.counts.low, maxVolume, plotHeight));
  const yMedium = buckets.map((b) =>
    yForCount(b.counts.low + b.counts.medium, maxVolume, plotHeight),
  );
  const yHigh = buckets.map((b) =>
    yForCount(
      b.counts.low + b.counts.medium + b.counts.high,
      maxVolume,
      plotHeight,
    ),
  );
  const yCrit = buckets.map((b) => yForCount(b.total, maxVolume, plotHeight));

  const baseline = buckets.map(() => plotHeight);

  return {
    low: closedBandPath(leftEdgeX, rightEdgeX, midX, yLow, baseline),
    medium: closedBandPath(leftEdgeX, rightEdgeX, midX, yMedium, yLow),
    high: closedBandPath(leftEdgeX, rightEdgeX, midX, yHigh, yMedium),
    critical: closedBandPath(leftEdgeX, rightEdgeX, midX, yCrit, yHigh),
    lowTopLine: topLinePath(leftEdgeX, rightEdgeX, midX, yLow),
    mediumTopLine: topLinePath(leftEdgeX, rightEdgeX, midX, yMedium),
    highTopLine: topLinePath(leftEdgeX, rightEdgeX, midX, yHigh),
    critTopLine: topLinePath(leftEdgeX, rightEdgeX, midX, yCrit),
  };
}

/** Closed polygon: top edge along `topY`, bottom edge along `bottomY`, with
 *  leftmost/rightmost extension to chart edges. */
function closedBandPath(
  leftEdgeX: number,
  rightEdgeX: number,
  midX: number[],
  topY: number[],
  bottomY: number[],
): string {
  const n = midX.length;
  if (n === 0) return "";

  const parts: string[] = [];
  // Top edge: left chart edge → midpoints → right chart edge.
  parts.push(`M ${fmt(leftEdgeX)} ${fmt(topY[0])}`);
  for (let i = 0; i < n; i++) {
    parts.push(`L ${fmt(midX[i])} ${fmt(topY[i])}`);
  }
  parts.push(`L ${fmt(rightEdgeX)} ${fmt(topY[n - 1])}`);
  // Bottom edge (reversed): right chart edge → midpoints → left chart edge.
  parts.push(`L ${fmt(rightEdgeX)} ${fmt(bottomY[n - 1])}`);
  for (let i = n - 1; i >= 0; i--) {
    parts.push(`L ${fmt(midX[i])} ${fmt(bottomY[i])}`);
  }
  parts.push(`L ${fmt(leftEdgeX)} ${fmt(bottomY[0])}`);
  parts.push("Z");
  return parts.join(" ");
}

/** Stroke-only top edge: left chart edge → midpoints → right chart edge.
 *  No bottom edge, no Z. */
function topLinePath(
  leftEdgeX: number,
  rightEdgeX: number,
  midX: number[],
  topY: number[],
): string {
  const n = midX.length;
  if (n === 0) return "";

  const parts: string[] = [];
  parts.push(`M ${fmt(leftEdgeX)} ${fmt(topY[0])}`);
  for (let i = 0; i < n; i++) {
    parts.push(`L ${fmt(midX[i])} ${fmt(topY[i])}`);
  }
  parts.push(`L ${fmt(rightEdgeX)} ${fmt(topY[n - 1])}`);
  return parts.join(" ");
}
