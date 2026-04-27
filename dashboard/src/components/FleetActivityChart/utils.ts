import type { ActivityCategory, EntryResponse, RiskTier } from "../../lib/types";

// ── Constants ───────────────────────────────────────────────

/** Lane order top-to-bottom in the swarm chart.
 *  Stable so CATEGORY_META lookups in the legend align with lane centers. */
export const LANE_ORDER: ActivityCategory[] = [
  "exploring",
  "changes",
  "git",
  "scripts",
  "web",
  "comms",
  "orchestration",
  "media",
];

/** Horizontal px threshold for merging adjacent dots within a lane.
 *  Widened to 14 to track the larger (r=8) icon-bearing single-dot shape. */
export const CLUSTER_PX = 14;

// ── Types ───────────────────────────────────────────────────

/** One dot to render — a mapped EntryResponse plus its pixel coordinates. */
export interface SwarmDot {
  entry: EntryResponse;
  cx: number;
  cy: number;
}

/** One rendered glyph — either a solo dot or a merged cluster. */
export interface SwarmCluster {
  dots: SwarmDot[];
  cx: number;
  cy: number;
  worstTier: RiskTier | undefined;
  isCluster: boolean;
}

/** A single axis tick, already placed in time. Pixel position is applied at render. */
export interface AxisTick {
  ms: number;
  label: string;
}

// ── Jitter ──────────────────────────────────────────────────

/**
 * Stable pseudo-random jitter for a dot within its lane.
 * Returns a value in `[-0.175 * laneHeight, 0.175 * laneHeight]` — tightened
 * from the original ±35% now that dots are r=8 (16px diameter) and need room
 * to sit centered without spilling into adjacent lanes.
 *
 * Deterministic in the key so re-renders don't shuffle the swarm pattern.
 */
export function jitterForKey(key: string, laneHeight: number): number {
  let h = 5381;
  for (let i = 0; i < key.length; i++) {
    h = ((h << 5) + h + key.charCodeAt(i)) | 0;
  }
  const frac = (Math.abs(h) % 1000) / 1000; // [0, 1)
  return (frac - 0.5) * 0.35 * laneHeight;
}

// ── Lane math ──────────────────────────────────────────────

/** Y-center of the given category's lane in a chart of `chartHeight` pixels. */
export function laneYForCategory(cat: ActivityCategory, chartHeight: number): number {
  const idx = LANE_ORDER.indexOf(cat);
  // Unknown categories fall into the scripts lane (matches getCategory's fallback).
  const safeIdx = idx >= 0 ? idx : LANE_ORDER.indexOf("scripts");
  const laneH = chartHeight / LANE_ORDER.length;
  return laneH * (safeIdx + 0.5);
}

/** Lane height for a chart of `chartHeight` pixels. */
export function laneHeight(chartHeight: number): number {
  return chartHeight / LANE_ORDER.length;
}

// ── Risk tier helpers ──────────────────────────────────────

const TIER_RANK: Record<RiskTier, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

/** Worst (highest-severity) tier present in the list, or undefined if empty. */
export function worstTier(tiers: (RiskTier | undefined)[]): RiskTier | undefined {
  let best: RiskTier | undefined;
  for (const t of tiers) {
    if (!t) continue;
    if (!best || TIER_RANK[t] > TIER_RANK[best]) best = t;
  }
  return best;
}

/**
 * Halo radius offset for a given tier. Low/medium get 0 (no halo — their
 * colors clash with category colors). High +3, critical +4.
 */
export function haloRadiusOffset(tier: RiskTier | undefined): number {
  if (tier === "critical") return 4;
  if (tier === "high") return 3;
  return 0;
}

// ── Clustering (per lane) ──────────────────────────────────

/**
 * Merge dots whose cx falls within `threshold` of the previous dot's cx.
 * Operates in a single pass after sorting by cx ascending. Each output
 * cluster's cx is the arithmetic mean of its members' cx; likewise for cy.
 *
 * Callers must pass dots for a single lane only — different-lane dots are
 * not merged (different cy, different category, different legend row).
 */
export function clusterDots(dots: SwarmDot[], threshold: number): SwarmCluster[] {
  if (dots.length === 0) return [];
  const sorted = [...dots].sort((a, b) => a.cx - b.cx);
  const out: SwarmCluster[] = [];
  let group: SwarmDot[] = [];
  for (const d of sorted) {
    if (group.length === 0 || d.cx - group[group.length - 1].cx < threshold) {
      group.push(d);
    } else {
      out.push(toCluster(group));
      group = [d];
    }
  }
  if (group.length > 0) out.push(toCluster(group));
  return out;
}

function toCluster(group: SwarmDot[]): SwarmCluster {
  let cxSum = 0;
  let cySum = 0;
  const tiers: (RiskTier | undefined)[] = [];
  for (const d of group) {
    cxSum += d.cx;
    cySum += d.cy;
    tiers.push(d.entry.riskTier as RiskTier | undefined);
  }
  return {
    dots: group,
    cx: cxSum / group.length,
    cy: cySum / group.length,
    worstTier: worstTier(tiers),
    isCluster: group.length > 1,
  };
}

// ── Time → pixel mapping ───────────────────────────────────

/** Build a time→x mapper over `[startMs, endMs]` → `[0, width]`. */
export function makeTimeToX(
  startMs: number,
  endMs: number,
  width: number,
): (ms: number) => number {
  const span = endMs - startMs || 1;
  return (ms: number) => ((ms - startMs) / span) * width;
}

// ── Axis ticks ─────────────────────────────────────────────

const MIN_MS = 60_000;

/** Hour-tick interval for the 7 non-7d ranges. Salvaged from the old FleetChart. */
function tickIntervalMs(range: string): number {
  switch (range) {
    case "1h":
      return 15 * MIN_MS;
    case "3h":
      return 30 * MIN_MS;
    case "6h":
    case "12h":
      return 60 * MIN_MS;
    case "24h":
      return 2 * 60 * MIN_MS;
    case "48h":
      return 4 * 60 * MIN_MS;
    default:
      return 60 * MIN_MS;
  }
}

function fmtHour(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "pm" : "am";
  const h12 = h % 12 || 12;
  if (m === 0) return `${h12}${ampm}`;
  return `${h12}:${String(m).padStart(2, "0")}${ampm}`;
}

/** Hour-granularity ticks for the non-7d ranges. */
export function buildHourTicks(startMs: number, endMs: number, range: string): AxisTick[] {
  const interval = tickIntervalMs(range);
  const ticks: AxisTick[] = [];
  const firstTick = Math.ceil(startMs / interval) * interval;
  for (let t = firstTick; t <= endMs; t += interval) {
    ticks.push({ ms: t, label: fmtHour(t) });
  }
  return ticks;
}

/** One tick per local midnight in `[startMs, endMs]`, labeled with the
 *  weekday short (`Mon`, `Tue`, …). Used by the 7d view. */
export function buildDayTicks(startMs: number, endMs: number): AxisTick[] {
  const ticks: AxisTick[] = [];
  const first = new Date(startMs);
  first.setHours(0, 0, 0, 0);
  // If rounding down landed before startMs, bump to the next midnight.
  if (first.getTime() < startMs) first.setDate(first.getDate() + 1);
  let cursor = first.getTime();
  while (cursor <= endMs) {
    const d = new Date(cursor);
    ticks.push({
      ms: cursor,
      label: d.toLocaleDateString("en-US", { weekday: "short" }),
    });
    const next = new Date(cursor);
    next.setDate(next.getDate() + 1);
    cursor = next.getTime();
  }
  return ticks;
}

/**
 * Drop labels that would crowd each other. Returns the set of tick-ms values
 * whose labels survive — the tick LINE still draws for every tick, only the
 * text is suppressed.
 */
export function cullLabelsForWidth(
  ticks: AxisTick[],
  timeToX: (ms: number) => number,
  minGapPx = 40,
): Set<number> {
  const shown = new Set<number>();
  let lastX = Number.NEGATIVE_INFINITY;
  for (const t of ticks) {
    const x = timeToX(t.ms);
    if (x - lastX >= minGapPx) {
      shown.add(t.ms);
      lastX = x;
    }
  }
  return shown;
}
