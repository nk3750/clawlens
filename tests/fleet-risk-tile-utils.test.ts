// Tests for dashboard/src/components/FleetRiskTile/utils.ts — pure math.
// Spec: docs/product/homepage-bottom-row-spec.md §6.3, §6.5

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bucketCountsByTier,
  bucketEntriesByHour,
  CRIT_THRESHOLD,
  clampTooltipX,
  HIGH_THRESHOLD,
  midpointLinearAreaPath,
  type TierBucket,
  tierStackedPaths,
  yForCount,
  yForScore,
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
// yForScore
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// Tier thresholds (#23 — both names exported for clipPath math)
// ─────────────────────────────────────────────────────────────

describe("tier thresholds", () => {
  it("HIGH_THRESHOLD is 50 (high tier starts at score 50)", () => {
    expect(HIGH_THRESHOLD).toBe(50);
  });
  it("CRIT_THRESHOLD is 75 (crit tier starts at score 75) — locked alongside HIGH for symmetry", () => {
    expect(CRIT_THRESHOLD).toBe(75);
  });
});

describe("yForScore — maps [30, 100] into [plotHeight, 0]", () => {
  it("score 100 → y = 0 (top of plot)", () => {
    expect(yForScore(100, 100)).toBe(0);
  });
  it("score 30 → y = plotHeight (bottom)", () => {
    expect(yForScore(30, 100)).toBe(100);
  });
  it("score 65 → y = plotHeight / 2 (mid)", () => {
    expect(yForScore(65, 100)).toBe(50);
  });
  it("clamps sub-30 scores to the floor (y = plotHeight)", () => {
    expect(yForScore(0, 100)).toBe(100);
    expect(yForScore(-50, 100)).toBe(100);
  });
  it("75 threshold lands partway up", () => {
    // (75-30)/70 = 0.6428... → plotHeight * 0.357 = ~35.7
    expect(yForScore(75, 100)).toBeCloseTo(35.714, 2);
  });
  it("scales with arbitrary plotHeights", () => {
    expect(yForScore(100, 50)).toBe(0);
    expect(yForScore(30, 50)).toBe(50);
  });
});

// ─────────────────────────────────────────────────────────────
// bucketEntriesByHour
// ─────────────────────────────────────────────────────────────

describe("bucketEntriesByHour — max per bucket with 30 floor", () => {
  function at(hoursAgo: number, score: number): EntryResponse {
    return entry({
      timestamp: new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString(),
      riskScore: score,
    });
  }

  it("returns 24 buckets for 24h range", () => {
    const buckets = bucketEntriesByHour({
      entries: [],
      startMs: NOW.getTime() - 24 * 3_600_000,
      endMs: NOW.getTime(),
      bucketCount: 24,
    });
    expect(buckets.length).toBe(24);
  });
  it("returns 7 buckets for 7d range", () => {
    const buckets = bucketEntriesByHour({
      entries: [],
      startMs: NOW.getTime() - 7 * 24 * 3_600_000,
      endMs: NOW.getTime(),
      bucketCount: 7,
    });
    expect(buckets.length).toBe(7);
  });
  it("empty buckets get the 30 floor", () => {
    const buckets = bucketEntriesByHour({
      entries: [],
      startMs: NOW.getTime() - 24 * 3_600_000,
      endMs: NOW.getTime(),
      bucketCount: 24,
    });
    for (const b of buckets) {
      expect(b.max).toBe(30);
    }
  });
  it("takes max riskScore per bucket", () => {
    const buckets = bucketEntriesByHour({
      entries: [at(0.5, 60), at(1.5, 80), at(2.5, 40)],
      startMs: NOW.getTime() - 24 * 3_600_000,
      endMs: NOW.getTime(),
      bucketCount: 24,
    });
    // Buckets run oldest→newest. The at(0.5) entry lands in the most-recent
    // full hour; at(1.5) in the hour before; at(2.5) two hours before.
    const last = buckets[buckets.length - 1];
    expect(last.max).toBe(60);
    expect(buckets[buckets.length - 2].max).toBe(80);
    expect(buckets[buckets.length - 3].max).toBe(40);
  });
  it("clamps sub-30 scores to floor", () => {
    const buckets = bucketEntriesByHour({
      entries: [at(0.5, 15)],
      startMs: NOW.getTime() - 24 * 3_600_000,
      endMs: NOW.getTime(),
      bucketCount: 24,
    });
    // If the only event in a bucket scores below 30, bucket.max still clamps
    // to the 30 floor — spec §6.3 "Values below 30 clamp to 30 — a visual
    // floor so hours with no events don't cause the area to collapse to zero."
    const last = buckets[buckets.length - 1];
    expect(last.max).toBe(30);
  });
  it("each bucket's startMs/endMs covers its slice of [startMs, endMs]", () => {
    const s = NOW.getTime() - 24 * 3_600_000;
    const e = NOW.getTime();
    const buckets = bucketEntriesByHour({
      entries: [],
      startMs: s,
      endMs: e,
      bucketCount: 24,
    });
    // First bucket starts at s.
    expect(buckets[0].startMs).toBe(s);
    // Last bucket ends at e (±1ms tolerance for integer division).
    expect(buckets[buckets.length - 1].endMs).toBeCloseTo(e, -2);
    // Buckets are contiguous.
    for (let i = 1; i < buckets.length; i++) {
      expect(buckets[i].startMs).toBe(buckets[i - 1].endMs);
    }
  });
});

// ─────────────────────────────────────────────────────────────
// midpointLinearAreaPath (polish-2 §2 — replaces steppedAreaPath)
// ─────────────────────────────────────────────────────────────

describe("midpointLinearAreaPath — polyline through bucket midpoints", () => {
  it("empty bucket list → empty path (no NaNs)", () => {
    const d = midpointLinearAreaPath({
      buckets: [],
      timeToX: (ms: number) => ms,
      plotHeight: 100,
    });
    expect(d).toBe("");
  });

  it("1-bucket degenerate case → M x plotHeight L x peak L x plotHeight Z", () => {
    // One bucket: firstX === lastX (both the single midpoint). The path
    // collapses to a vertical line segment closed with Z — acceptable.
    const d = midpointLinearAreaPath({
      buckets: [{ max: 60, startMs: 0, endMs: 10 }],
      timeToX: (ms: number) => ms,
      plotHeight: 100,
    });
    // midpoint = 5, yForScore(60,100) = 100 * (1 - 30/70) ≈ 57.14
    expect(d).toBe("M 5 100 L 5 57.14 L 5 100 Z");
  });

  it("N buckets → M + (N + 1) L + Z for N buckets (one L per midpoint + closing L)", () => {
    const buckets = [
      { max: 40, startMs: 0, endMs: 10 }, // midpoint 5
      { max: 80, startMs: 10, endMs: 20 }, // midpoint 15
      { max: 60, startMs: 20, endMs: 30 }, // midpoint 25
    ];
    const d = midpointLinearAreaPath({
      buckets,
      timeToX: (ms: number) => ms,
      plotHeight: 100,
    });
    const tokens = d.split(" ");
    const lCount = tokens.filter((t) => t === "L").length;
    // 3 buckets → 3 midpoint Ls + 1 closing L = 4
    expect(lCount).toBe(4);
    expect(tokens[0]).toBe("M");
    expect(tokens[tokens.length - 1]).toBe("Z");
  });

  it("starts at baseline-left (first midpoint x, plotHeight)", () => {
    const d = midpointLinearAreaPath({
      buckets: [
        { max: 60, startMs: 0, endMs: 10 },
        { max: 80, startMs: 10, endMs: 20 },
      ],
      timeToX: (ms: number) => ms,
      plotHeight: 100,
    });
    // First midpoint is at x = 5, baseline y = 100.
    expect(d.startsWith("M 5 100 ")).toBe(true);
  });

  it("ends at baseline-right (last midpoint x, plotHeight) before Z", () => {
    const d = midpointLinearAreaPath({
      buckets: [
        { max: 60, startMs: 0, endMs: 10 },
        { max: 80, startMs: 10, endMs: 20 },
      ],
      timeToX: (ms: number) => ms,
      plotHeight: 100,
    });
    // Last midpoint is at x = 15, baseline y = 100.
    expect(d.endsWith("L 15 100 Z")).toBe(true);
  });

  it("middle Ls pass through midpoint y-coordinates (yForScore of each bucket max)", () => {
    const d = midpointLinearAreaPath({
      buckets: [
        { max: 40, startMs: 0, endMs: 10 },
        { max: 80, startMs: 10, endMs: 20 },
      ],
      timeToX: (ms: number) => ms,
      plotHeight: 100,
    });
    // 40 → yForScore(40,100) = 100 * (1 - 10/70) ≈ 85.71
    // 80 → yForScore(80,100) = 100 * (1 - 50/70) ≈ 28.57
    expect(d).toMatch(/85\.71/);
    expect(d).toMatch(/28\.57/);
  });

  it("midpoints are at (startMs + endMs) / 2 (not bucket edges)", () => {
    // Bucket [0, 10] has midpoint 5, not 0 or 10. With timeToX = identity,
    // the path must contain the literal value "5" somewhere.
    const d = midpointLinearAreaPath({
      buckets: [{ max: 60, startMs: 0, endMs: 10 }],
      timeToX: (ms: number) => ms,
      plotHeight: 100,
    });
    // ALL x coordinates are the single midpoint = 5 (integer serialized).
    const tokens = d.split(" ");
    const xCoords = [tokens[1], tokens[4], tokens[7]];
    expect(xCoords.every((x) => x === "5")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// clampTooltipX (polish §5.3)
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
