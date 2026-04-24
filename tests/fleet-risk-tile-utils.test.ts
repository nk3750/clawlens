// Tests for dashboard/src/components/FleetRiskTile/utils.ts — pure math.
// Spec: docs/product/homepage-bottom-row-spec.md §6.3, §6.5

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bucketEntriesByHour,
  clampTooltipX,
  midpointLinearAreaPath,
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
