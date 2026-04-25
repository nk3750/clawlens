// Tests for dashboard/src/components/FleetRiskTile/utils.ts — pure math.
// Spec: docs/product/implemented/fleet-risk-tile-volume-area-spec.md

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bucketCountsByTier,
  CRIT_THRESHOLD,
  clampTooltipX,
  type TierBucket,
  tierStackedPaths,
  yForCount,
} from "../dashboard/src/components/FleetRiskTile/utils";
import type { EntryResponse } from "../dashboard/src/lib/types";

const NOW = new Date("2026-04-24T12:00:00.000Z");

function entry(partial: Partial<EntryResponse> = {}): EntryResponse {
  return {
    timestamp: NOW.toISOString(),
    toolName: "exec",
    params: {},
    effectiveDecision: "allow",
    category: "exploring",
    ...partial,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

// ─────────────────────────────────────────────────────────────
// Tier threshold value lock
// ─────────────────────────────────────────────────────────────

describe("tier thresholds", () => {
  it("CRIT_THRESHOLD is 75 (crit tier starts at score 75)", () => {
    expect(CRIT_THRESHOLD).toBe(75);
  });
});

// ─────────────────────────────────────────────────────────────
// clampTooltipX
// ─────────────────────────────────────────────────────────────

describe("clampTooltipX — keeps the tooltip inside the SVG", () => {
  const SVG_W = 420;
  const TIP_W = 220;

  it("centers the tooltip on the dot when there is room on both sides", () => {
    // Dot in the middle → centered result dotX - tipWidth/2
    expect(clampTooltipX(210, SVG_W, TIP_W)).toBe(100); // 210 - 110
  });
  it("clamps to left edge (x = 0) when the dot is near the left", () => {
    expect(clampTooltipX(20, SVG_W, TIP_W)).toBe(0);
  });
  it("clamps to right edge (x = svgWidth - tipWidth) when the dot is near the right", () => {
    // NOW line lives at VIEW_WIDTH - NOW_LINE_INSET (416) → tooltip must
    // snap back so it never clips at the right edge.
    expect(clampTooltipX(415, SVG_W, TIP_W)).toBe(200); // 420 - 220
  });
  it("uses the default tipWidth of 220 when the third arg is omitted", () => {
    expect(clampTooltipX(210, SVG_W)).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────
// bucketCountsByTier — 4-tier counts per bucket
// (FleetRiskTile sparkline → tier-stacked volume area, 2026-04-25 spec)
// ─────────────────────────────────────────────────────────────

describe("bucketCountsByTier — 4-tier counts per bucket", () => {
  const startMs = NOW.getTime() - 24 * 3_600_000;
  const endMs = NOW.getTime();
  const TWENTY_FOUR_H = { startMs, endMs, bucketCount: 24 };

  function entryAt(opts: {
    hoursAgo: number;
    tier?: string;
    decision?: string;
    effectiveDecision?: string;
    riskScore?: number;
  }): EntryResponse {
    return entry({
      timestamp: new Date(NOW.getTime() - opts.hoursAgo * 3_600_000).toISOString(),
      riskTier: opts.tier,
      decision: opts.decision,
      effectiveDecision: opts.effectiveDecision ?? "allow",
      riskScore: opts.riskScore,
    });
  }

  it("returns the requested bucketCount with contiguous startMs/endMs", () => {
    const buckets = bucketCountsByTier({ entries: [], ...TWENTY_FOUR_H });
    expect(buckets.length).toBe(24);
    expect(buckets[0].startMs).toBe(startMs);
    expect(buckets[buckets.length - 1].endMs).toBeCloseTo(endMs, -2);
    for (let i = 1; i < buckets.length; i++) {
      expect(buckets[i].startMs).toBe(buckets[i - 1].endMs);
    }
  });

  it("empty entries → all buckets have zero counts and total=0", () => {
    const buckets = bucketCountsByTier({ entries: [], ...TWENTY_FOUR_H });
    for (const b of buckets) {
      expect(b.counts.low).toBe(0);
      expect(b.counts.medium).toBe(0);
      expect(b.counts.high).toBe(0);
      expect(b.counts.critical).toBe(0);
      expect(b.total).toBe(0);
    }
  });

  it("classifies entry by riskTier=low", () => {
    const buckets = bucketCountsByTier({
      entries: [entryAt({ hoursAgo: 0.5, tier: "low" })],
      ...TWENTY_FOUR_H,
    });
    const last = buckets[buckets.length - 1];
    expect(last.counts.low).toBe(1);
    expect(last.counts.medium).toBe(0);
    expect(last.counts.high).toBe(0);
    expect(last.counts.critical).toBe(0);
    expect(last.total).toBe(1);
  });

  it("classifies entry by riskTier=medium", () => {
    const buckets = bucketCountsByTier({
      entries: [entryAt({ hoursAgo: 0.5, tier: "medium" })],
      ...TWENTY_FOUR_H,
    });
    const last = buckets[buckets.length - 1];
    expect(last.counts.medium).toBe(1);
    expect(last.total).toBe(1);
  });

  it("classifies entry by riskTier=high", () => {
    const buckets = bucketCountsByTier({
      entries: [entryAt({ hoursAgo: 0.5, tier: "high" })],
      ...TWENTY_FOUR_H,
    });
    const last = buckets[buckets.length - 1];
    expect(last.counts.high).toBe(1);
    expect(last.total).toBe(1);
  });

  it("classifies entry by riskTier=critical", () => {
    const buckets = bucketCountsByTier({
      entries: [entryAt({ hoursAgo: 0.5, tier: "critical" })],
      ...TWENTY_FOUR_H,
    });
    const last = buckets[buckets.length - 1];
    expect(last.counts.critical).toBe(1);
    expect(last.total).toBe(1);
  });

  it("decision-fallback: block without riskTier → critical", () => {
    // Mirrors backend getEffectiveTier: for pre-fd94778 guardrail rows that
    // never persisted a riskTier, the decision drives the classification.
    const buckets = bucketCountsByTier({
      entries: [entryAt({ hoursAgo: 0.5, decision: "block" })],
      ...TWENTY_FOUR_H,
    });
    const last = buckets[buckets.length - 1];
    expect(last.counts.critical).toBe(1);
    expect(last.counts.high).toBe(0);
    expect(last.total).toBe(1);
  });

  it("decision-fallback: approval_required without riskTier → high", () => {
    const buckets = bucketCountsByTier({
      entries: [entryAt({ hoursAgo: 0.5, decision: "approval_required" })],
      ...TWENTY_FOUR_H,
    });
    const last = buckets[buckets.length - 1];
    expect(last.counts.high).toBe(1);
    expect(last.counts.critical).toBe(0);
    expect(last.total).toBe(1);
  });

  it("drops allow-without-score (decision=allow, no riskTier) — absence of signal is not a low-tier signal", () => {
    const buckets = bucketCountsByTier({
      entries: [entryAt({ hoursAgo: 0.5, decision: "allow" })],
      ...TWENTY_FOUR_H,
    });
    for (const b of buckets) {
      expect(b.total).toBe(0);
      expect(b.counts.low).toBe(0);
      expect(b.counts.medium).toBe(0);
      expect(b.counts.high).toBe(0);
      expect(b.counts.critical).toBe(0);
    }
  });

  it("drops timeout-without-score (decision=timeout, no riskTier)", () => {
    const buckets = bucketCountsByTier({
      entries: [entryAt({ hoursAgo: 0.5, decision: "timeout" })],
      ...TWENTY_FOUR_H,
    });
    for (const b of buckets) {
      expect(b.total).toBe(0);
    }
  });

  it("drops entries with no riskTier and no decision (defensive fall-through)", () => {
    const buckets = bucketCountsByTier({
      entries: [entryAt({ hoursAgo: 0.5 })], // entry() helper leaves decision unset
      ...TWENTY_FOUR_H,
    });
    for (const b of buckets) {
      expect(b.total).toBe(0);
    }
  });

  it("riskTier wins over decision (precedence: tier first, then decision fallback)", () => {
    // riskTier="low" + decision="block" should classify as low — the persisted
    // tier is the source of truth when present.
    const buckets = bucketCountsByTier({
      entries: [entryAt({ hoursAgo: 0.5, tier: "low", decision: "block" })],
      ...TWENTY_FOUR_H,
    });
    const last = buckets[buckets.length - 1];
    expect(last.counts.low).toBe(1);
    expect(last.counts.critical).toBe(0);
  });

  it("excludes out-of-window entries (before startMs)", () => {
    const buckets = bucketCountsByTier({
      entries: [entryAt({ hoursAgo: 25, tier: "critical" })],
      ...TWENTY_FOUR_H,
    });
    for (const b of buckets) expect(b.total).toBe(0);
  });

  it("excludes entries at or after endMs (endMs is exclusive)", () => {
    const buckets = bucketCountsByTier({
      entries: [entry({ timestamp: NOW.toISOString(), riskTier: "critical" })],
      ...TWENTY_FOUR_H,
    });
    for (const b of buckets) expect(b.total).toBe(0);
  });

  it("entry exactly at b.endMs lands in the next bucket (boundary inclusivity)", () => {
    const initial = bucketCountsByTier({ entries: [], ...TWENTY_FOUR_H });
    const boundaryMs = initial[0].endMs; // start of bucket[1]
    const buckets = bucketCountsByTier({
      entries: [entry({ timestamp: new Date(boundaryMs).toISOString(), riskTier: "critical" })],
      ...TWENTY_FOUR_H,
    });
    expect(buckets[0].counts.critical).toBe(0);
    expect(buckets[1].counts.critical).toBe(1);
  });

  it("multiple entries across tiers accumulate correctly within one bucket", () => {
    const buckets = bucketCountsByTier({
      entries: [
        entryAt({ hoursAgo: 0.5, tier: "low" }),
        entryAt({ hoursAgo: 0.5, tier: "low" }),
        entryAt({ hoursAgo: 0.5, tier: "medium" }),
        entryAt({ hoursAgo: 0.5, tier: "critical" }),
        entryAt({ hoursAgo: 0.5, decision: "block" }), // → critical via fallback
      ],
      ...TWENTY_FOUR_H,
    });
    const last = buckets[buckets.length - 1];
    expect(last.counts.low).toBe(2);
    expect(last.counts.medium).toBe(1);
    expect(last.counts.high).toBe(0);
    expect(last.counts.critical).toBe(2);
    expect(last.total).toBe(5);
  });

  it("returns empty array when bucketCount <= 0 or window is degenerate", () => {
    expect(bucketCountsByTier({ entries: [], startMs, endMs, bucketCount: 0 }).length).toBe(0);
    expect(
      bucketCountsByTier({ entries: [], startMs: endMs, endMs: startMs, bucketCount: 24 }).length,
    ).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// yForCount — linear count → y scale
// ─────────────────────────────────────────────────────────────

describe("yForCount — linear count→y scale", () => {
  it("count 0 → y = plotHeight (bottom)", () => {
    expect(yForCount(0, 10, 100)).toBe(100);
  });
  it("count = maxVolume → y = 0 (top)", () => {
    expect(yForCount(10, 10, 100)).toBe(0);
  });
  it("count above maxVolume clamps to top (y = 0)", () => {
    expect(yForCount(15, 10, 100)).toBe(0);
  });
  it("negative count clamps to bottom (y = plotHeight)", () => {
    expect(yForCount(-5, 10, 100)).toBe(100);
  });
  it("scales linearly: count = maxVolume / 2 → y = plotHeight / 2", () => {
    expect(yForCount(5, 10, 100)).toBe(50);
  });
  it("scales with arbitrary plotHeights", () => {
    expect(yForCount(10, 10, 50)).toBe(0);
    expect(yForCount(0, 10, 50)).toBe(50);
    expect(yForCount(5, 10, 50)).toBe(25);
  });
  it("maxVolume = 0 → returns plotHeight (div-by-zero guard)", () => {
    expect(yForCount(0, 0, 100)).toBe(100);
    expect(yForCount(5, 0, 100)).toBe(100);
  });
  it("maxVolume < 1 → returns plotHeight (degenerate-domain guard)", () => {
    expect(yForCount(0, 0.5, 100)).toBe(100);
    expect(yForCount(0.4, 0.9, 100)).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────
// tierStackedPaths — 4 closed polygons + 4 stroke top-lines
// ─────────────────────────────────────────────────────────────

describe("tierStackedPaths — 4 closed polygons + 4 stroke top-lines", () => {
  function bucket(opts: {
    startMs: number;
    endMs: number;
    low?: number;
    medium?: number;
    high?: number;
    critical?: number;
  }): TierBucket {
    const counts = {
      low: opts.low ?? 0,
      medium: opts.medium ?? 0,
      high: opts.high ?? 0,
      critical: opts.critical ?? 0,
    };
    return {
      startMs: opts.startMs,
      endMs: opts.endMs,
      counts,
      total: counts.low + counts.medium + counts.high + counts.critical,
    };
  }

  it("empty buckets → all 8 path strings empty", () => {
    const paths = tierStackedPaths({
      buckets: [],
      maxVolume: 5,
      timeToX: (ms: number) => ms,
      plotHeight: 100,
    });
    expect(paths.low).toBe("");
    expect(paths.medium).toBe("");
    expect(paths.high).toBe("");
    expect(paths.critical).toBe("");
    expect(paths.lowTopLine).toBe("");
    expect(paths.mediumTopLine).toBe("");
    expect(paths.highTopLine).toBe("");
    expect(paths.critTopLine).toBe("");
  });

  it("returns object with 8 named keys", () => {
    const paths = tierStackedPaths({
      buckets: [bucket({ startMs: 0, endMs: 10, low: 1 })],
      maxVolume: 5,
      timeToX: (ms: number) => ms,
      plotHeight: 100,
    });
    expect(Object.keys(paths).sort()).toEqual([
      "critTopLine",
      "critical",
      "high",
      "highTopLine",
      "low",
      "lowTopLine",
      "medium",
      "mediumTopLine",
    ]);
  });

  it("non-empty buckets produce non-empty path strings (even when collapsed)", () => {
    const paths = tierStackedPaths({
      buckets: [bucket({ startMs: 0, endMs: 10, low: 1 })],
      maxVolume: 5,
      timeToX: (ms: number) => ms,
      plotHeight: 100,
    });
    for (const key of [
      "low",
      "medium",
      "high",
      "critical",
      "lowTopLine",
      "mediumTopLine",
      "highTopLine",
      "critTopLine",
    ] as const) {
      expect(paths[key]).not.toBe("");
    }
  });

  it("polygons close with Z; top lines do not (stroke-only)", () => {
    const paths = tierStackedPaths({
      buckets: [bucket({ startMs: 0, endMs: 10, low: 1, medium: 1, high: 1, critical: 1 })],
      maxVolume: 4,
      timeToX: (ms: number) => ms,
      plotHeight: 100,
    });
    expect(paths.low.endsWith("Z")).toBe(true);
    expect(paths.medium.endsWith("Z")).toBe(true);
    expect(paths.high.endsWith("Z")).toBe(true);
    expect(paths.critical.endsWith("Z")).toBe(true);
    expect(paths.lowTopLine.endsWith("Z")).toBe(false);
    expect(paths.mediumTopLine.endsWith("Z")).toBe(false);
    expect(paths.highTopLine.endsWith("Z")).toBe(false);
    expect(paths.critTopLine.endsWith("Z")).toBe(false);
  });

  it("cumulative top y stack: tiers stack correctly (yCrit ≤ yHigh ≤ yMedium ≤ yLow at the same bucket)", () => {
    // counts {1,1,1,1}, total=4, maxVol=4 → fills full chart height.
    //   yLow    = yForCount(1, 4, 100) = 75
    //   yMedium = yForCount(2, 4, 100) = 50
    //   yHigh   = yForCount(3, 4, 100) = 25
    //   yCrit   = yForCount(4, 4, 100) = 0
    const paths = tierStackedPaths({
      buckets: [bucket({ startMs: 0, endMs: 10, low: 1, medium: 1, high: 1, critical: 1 })],
      maxVolume: 4,
      timeToX: (ms: number) => ms,
      plotHeight: 100,
    });
    expect(paths.lowTopLine).toContain(" 75");
    expect(paths.mediumTopLine).toContain(" 50");
    expect(paths.highTopLine).toContain(" 25");
    // critTopLine fills to top (y=0 — written as "0" via fmt).
    expect(paths.critTopLine).toMatch(/\b0\b/);
  });

  it("low polygon's bottom edge sits at plotHeight (constant baseline)", () => {
    const paths = tierStackedPaths({
      buckets: [
        bucket({ startMs: 0, endMs: 10, low: 1 }),
        bucket({ startMs: 10, endMs: 20, low: 2 }),
      ],
      maxVolume: 5,
      timeToX: (ms: number) => ms,
      plotHeight: 100,
    });
    // Bottom edge tokens = plotHeight. Confirm at least 2 points sit at y=100.
    const matches = paths.low.match(/\b100\b/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("leftmost top extends to timeToX(buckets[0].startMs); rightmost to timeToX(last.endMs)", () => {
    // buckets [0,10] and [10,20] with timeToX=identity → left edge=0, right edge=20.
    const paths = tierStackedPaths({
      buckets: [
        bucket({ startMs: 0, endMs: 10, critical: 1 }),
        bucket({ startMs: 10, endMs: 20, critical: 1 }),
      ],
      maxVolume: 1,
      timeToX: (ms: number) => ms,
      plotHeight: 100,
    });
    // critTopLine starts at the left chart edge (x=0).
    expect(paths.critTopLine.startsWith("M 0 ")).toBe(true);
    // critTopLine ends with the right chart edge (x=20). The last "L 20 …" token confirms extension.
    expect(paths.critTopLine).toMatch(/L 20 /);
    // Polygon also starts at x=0 (top edge first), and its bottom-edge close passes through x=0.
    expect(paths.critical.startsWith("M 0 ")).toBe(true);
  });

  it("zero-count tier in a bucket collapses to a flat strip but keeps the polygon non-empty", () => {
    // counts {0,0,0,critical:4} with maxVol=4 → low/medium/high all collapse at y=plotHeight,
    // critical fills full height.
    const paths = tierStackedPaths({
      buckets: [bucket({ startMs: 0, endMs: 10, critical: 4 })],
      maxVolume: 4,
      timeToX: (ms: number) => ms,
      plotHeight: 100,
    });
    // low's polygon collapses (top y == plotHeight), but its string is still non-empty.
    expect(paths.low).not.toBe("");
    // critTopLine reaches the top (y=0).
    expect(paths.critTopLine).toMatch(/\b0\b/);
  });

  it("respects an externally-passed maxVolume floor (caller decides; util doesn't apply its own floor)", () => {
    // Caller passes maxVolume=5 even though total=1 → the single critical entry only fills 1/5
    // of the chart height (yCrit = yForCount(1, 5, 100) = 80).
    const paths = tierStackedPaths({
      buckets: [bucket({ startMs: 0, endMs: 10, critical: 1 })],
      maxVolume: 5,
      timeToX: (ms: number) => ms,
      plotHeight: 100,
    });
    expect(paths.critTopLine).toContain(" 80");
  });
});
