// Tests for computeFleetRiskIndex in src/dashboard/api.ts.
// Spec: docs/product/homepage-bottom-row-spec.md §6.1
//
// Semantics (locked for v1):
//   current       = max riskScore in last 15 minutes, 0 if none
//   baselineP50   = median of daily-peak riskScores over last 7 COMPLETED days
//   delta         = current - baselineP50 (may be negative)
//   critCount     = entries in last 24h with riskScore >= 75
//   highCount     = entries in last 24h with 50 <= riskScore < 75
//   totalElevated = critCount + highCount

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditEntry } from "../src/audit/logger";
import { computeFleetRiskIndex } from "../src/dashboard/api";

// 2026-04-24 is a Friday. Use a local-midnight-safe "today" with an
// hour-offset so the 15-min window and 24h window are both fully inside
// today.
const NOW = new Date("2026-04-24T12:00:00.000Z");

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  // Production entries are written with riskScore + riskTier in lockstep (the
  // risk-scorer sets both). Mirror that invariant here so fixtures opting into
  // a score automatically get a matching tier — avoids salting every fixture
  // with a tier field that's really an implementation detail of the scorer.
  const score = overrides.riskScore;
  const defaultTier: AuditEntry["riskTier"] | undefined =
    score === undefined
      ? undefined
      : score >= 75
        ? "critical"
        : score >= 50
          ? "high"
          : score >= 30
            ? "medium"
            : "low";
  return {
    timestamp: NOW.toISOString(),
    toolName: "exec",
    params: {},
    prevHash: "0",
    hash: "h",
    decision: "allow",
    ...(defaultTier ? { riskTier: defaultTier } : {}),
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("computeFleetRiskIndex — empty log (fresh deploy)", () => {
  it("returns all zeros", () => {
    expect(computeFleetRiskIndex([])).toEqual({
      current: 0,
      baselineP50: 0,
      delta: 0,
      critCount: 0,
      highCount: 0,
      totalElevated: 0,
    });
  });
});

describe("computeFleetRiskIndex — current (last 1 hour max)", () => {
  it("returns max riskScore in the last 1 hour", () => {
    const out = computeFleetRiskIndex([
      entry({
        timestamp: new Date(NOW.getTime() - 5 * 60_000).toISOString(),
        riskScore: 40,
      }),
      entry({
        timestamp: new Date(NOW.getTime() - 2 * 60_000).toISOString(),
        riskScore: 72,
      }),
      entry({
        timestamp: new Date(NOW.getTime() - 10 * 60_000).toISOString(),
        riskScore: 55,
      }),
    ]);
    expect(out.current).toBe(72);
  });
  it("INCLUDES entries at age 50 minutes (inside the 1h window)", () => {
    const out = computeFleetRiskIndex([
      entry({
        timestamp: new Date(NOW.getTime() - 50 * 60_000).toISOString(),
        riskScore: 82,
      }),
    ]);
    expect(out.current).toBe(82);
  });
  it("excludes entries older than 1 hour", () => {
    const out = computeFleetRiskIndex([
      entry({
        timestamp: new Date(NOW.getTime() - 70 * 60_000).toISOString(),
        riskScore: 90,
      }),
    ]);
    expect(out.current).toBe(0);
  });
  it("excludes future entries (age < 0)", () => {
    const out = computeFleetRiskIndex([
      entry({
        timestamp: new Date(NOW.getTime() + 60_000).toISOString(),
        riskScore: 90,
      }),
    ]);
    expect(out.current).toBe(0);
  });
  it("treats missing riskScore as 0", () => {
    const out = computeFleetRiskIndex([
      entry({ timestamp: new Date(NOW.getTime() - 60_000).toISOString() }),
    ]);
    expect(out.current).toBe(0);
  });
});

describe("computeFleetRiskIndex — crit/high counts since start of today (polish-3 #5)", () => {
  it("counts crit (>=75) and high (50<=s<75) today — and not yesterday", () => {
    const h = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString();
    const out = computeFleetRiskIndex([
      entry({ timestamp: h(1), riskScore: 80 }), // crit
      entry({ timestamp: h(2), riskScore: 75 }), // crit (boundary)
      entry({ timestamp: h(3), riskScore: 50 }), // high (boundary)
      entry({ timestamp: h(4), riskScore: 60 }), // high
      entry({ timestamp: h(5), riskScore: 49 }), // neither
      entry({ timestamp: h(25), riskScore: 90 }), // yesterday → excluded
    ]);
    expect(out.critCount).toBe(2);
    expect(out.highCount).toBe(2);
    expect(out.totalElevated).toBe(4);
  });

  it("EXCLUDES an event from yesterday-local even if within rolling 24h (reconciles with donut)", () => {
    // Pin to an early-morning NOW so "yesterday 23:10 local" is only ~6h ago
    // (inside a rolling 24h window) but still calendar-yesterday. Donut uses
    // today-calendar-day; hero must match or the two numbers on the same page
    // contradict each other.
    const pinned = new Date(NOW);
    pinned.setHours(5, 0, 0, 0);
    vi.setSystemTime(pinned);

    const yesterday2310 = new Date(pinned);
    yesterday2310.setHours(23, 10, 0, 0);
    yesterday2310.setDate(yesterday2310.getDate() - 1);

    const out = computeFleetRiskIndex([
      entry({ timestamp: yesterday2310.toISOString(), riskScore: 80 }),
    ]);
    expect(out.critCount).toBe(0);
    expect(out.highCount).toBe(0);
  });

  it("INCLUDES an event from today-local even when age approaches 24h", () => {
    // Pin to late-evening NOW so "today 00:10 local" is ~23h40m ago — outside
    // a rolling 24h? No, still inside by margin. Key point: we want the
    // counter to stay stable across all of today even on long days.
    const pinned = new Date(NOW);
    pinned.setHours(23, 50, 0, 0);
    vi.setSystemTime(pinned);

    const today0010 = new Date(pinned);
    today0010.setHours(0, 10, 0, 0);

    const out = computeFleetRiskIndex([
      entry({ timestamp: today0010.toISOString(), riskScore: 80 }),
    ]);
    expect(out.critCount).toBe(1);
  });

  it("EXCLUDES non-decision entries (after_tool_call, eval) from counts", () => {
    // computeEnhancedStats (the donut source) filters to decision entries
    // only. Hero reconciliation requires the same filter — otherwise each
    // tool call is counted once for its before_tool_call decision, and again
    // for the after_tool_call / eval emits that carry the same riskScore.
    const out = computeFleetRiskIndex([
      entry({ riskScore: 80 }), // decision: allow by default → counted
      entry({ riskScore: 80, decision: undefined }), // result entry → skip
      entry({ riskScore: 80, decision: undefined }), // eval entry → skip
    ]);
    expect(out.critCount).toBe(1);
  });

  it("prefers the eval entry's riskTier over the decision entry's (donut parity)", () => {
    // Donut per-tier counts use effectiveTier = evalEntry?.riskTier ?? e.riskTier.
    // If the LLM eval persisted a downgraded tier, the donut reads that tier —
    // and the hero must agree, otherwise the two widgets disagree on a refresh.
    const out = computeFleetRiskIndex([
      entry({ toolCallId: "tc-eval", riskScore: 80 }),
      {
        timestamp: NOW.toISOString(),
        toolName: "exec",
        params: {},
        prevHash: "0",
        hash: "h-eval",
        refToolCallId: "tc-eval",
        riskTier: "medium",
        llmEvaluation: { adjustedScore: 40, reasoning: "re-scored" },
      } as unknown as AuditEntry,
    ]);
    expect(out.critCount).toBe(0);
    expect(out.highCount).toBe(0);
  });

  it("per-tier split uses effectiveTier (donut parity), not score thresholds", () => {
    // computeEnhancedStats counts per-tier via effectiveTier = evalEntry.riskTier ?? e.riskTier.
    // If the raw adjusted score is 78 (would be "critical" by threshold) but the
    // eval entry persisted riskTier="high", the donut reads "high" — and the hero
    // must render "high" too. Otherwise the two widgets contradict on-page.
    const out = computeFleetRiskIndex([
      entry({ toolCallId: "tc-tier", riskScore: 78, riskTier: "high" }),
      {
        timestamp: NOW.toISOString(),
        toolName: "exec",
        params: {},
        prevHash: "0",
        hash: "h-eval-tier",
        refToolCallId: "tc-tier",
        riskTier: "high",
        llmEvaluation: { adjustedScore: 78, reasoning: "tier pinned low" },
      } as unknown as AuditEntry,
    ]);
    expect(out.critCount).toBe(0);
    expect(out.highCount).toBe(1);
  });
});

describe("computeFleetRiskIndex — baselineP50 (median of 7 completed daily peaks)", () => {
  function atDay(daysAgo: number, hour: number): string {
    // Build an ISO timestamp for N days ago at local `hour`.
    const startOfToday = new Date(NOW);
    startOfToday.setHours(0, 0, 0, 0);
    const d = new Date(startOfToday.getTime() - daysAgo * 86_400_000);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  }

  it("uses 7 completed days (not today), median of daily peaks", () => {
    // Day peaks: [50, 60, 40, 80, 30, 70, 20]
    // Sorted:    [20, 30, 40, 50, 60, 70, 80] → median (index 3) = 50
    const out = computeFleetRiskIndex([
      entry({ timestamp: atDay(1, 10), riskScore: 50 }),
      entry({ timestamp: atDay(2, 10), riskScore: 60 }),
      entry({ timestamp: atDay(3, 10), riskScore: 40 }),
      entry({ timestamp: atDay(4, 10), riskScore: 80 }),
      entry({ timestamp: atDay(5, 10), riskScore: 30 }),
      entry({ timestamp: atDay(6, 10), riskScore: 70 }),
      entry({ timestamp: atDay(7, 10), riskScore: 20 }),
    ]);
    expect(out.baselineP50).toBe(50);
  });

  it("excludes today's events from the baseline window", () => {
    // One massive event today shouldn't skew the baseline. With no prior days
    // of history, baseline is 0 (all 7 prior days are empty → peaks = [0]*7).
    const out = computeFleetRiskIndex([
      entry({
        timestamp: new Date(NOW.getTime() - 3_600_000).toISOString(),
        riskScore: 95,
      }),
    ]);
    expect(out.baselineP50).toBe(0);
  });

  it("takes the MAX score per completed day before taking the median", () => {
    // Day 1 has multiple events: [10, 45, 90] → peak 90
    // Day 2: [60] → peak 60
    // Day 3-7: no events → peak 0 each
    // Sorted peaks: [0,0,0,0,0,60,90] → median = 0
    const out = computeFleetRiskIndex([
      entry({ timestamp: atDay(1, 6), riskScore: 10 }),
      entry({ timestamp: atDay(1, 10), riskScore: 45 }),
      entry({ timestamp: atDay(1, 14), riskScore: 90 }),
      entry({ timestamp: atDay(2, 10), riskScore: 60 }),
    ]);
    expect(out.baselineP50).toBe(0);
  });
});

describe("computeFleetRiskIndex — delta (signed)", () => {
  it("is current - baselineP50, positive when above baseline", () => {
    const h = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString();
    const d = (daysAgo: number, hour: number) => {
      const s = new Date(NOW);
      s.setHours(0, 0, 0, 0);
      const x = new Date(s.getTime() - daysAgo * 86_400_000);
      x.setHours(hour, 0, 0, 0);
      return x.toISOString();
    };
    // 7 days of peaks all at 40 → baseline 40.
    // Current (last 15 min): 80.
    // delta should be 40.
    const prior = [1, 2, 3, 4, 5, 6, 7].map((n) => entry({ timestamp: d(n, 10), riskScore: 40 }));
    const out = computeFleetRiskIndex([
      ...prior,
      entry({
        timestamp: new Date(NOW.getTime() - 3 * 60_000).toISOString(),
        riskScore: 80,
      }),
      // also need this to NOT be in the 24h window for the crit test below,
      // so put the older entries >24h back
      ...[25, 49, 73].map((h) =>
        entry({ timestamp: new Date(NOW.getTime() - h * 3_600_000).toISOString(), riskScore: 20 }),
      ),
    ]);
    expect(out.current).toBe(80);
    expect(out.baselineP50).toBe(40);
    expect(out.delta).toBe(40);
    // The h() helper is only used defensively above; silence unused warning:
    void h;
  });

  it("is negative when current < baselineP50 (quiet today)", () => {
    const d = (daysAgo: number, hour: number) => {
      const s = new Date(NOW);
      s.setHours(0, 0, 0, 0);
      const x = new Date(s.getTime() - daysAgo * 86_400_000);
      x.setHours(hour, 0, 0, 0);
      return x.toISOString();
    };
    const prior = [1, 2, 3, 4, 5, 6, 7].map((n) => entry({ timestamp: d(n, 10), riskScore: 60 }));
    const out = computeFleetRiskIndex([
      ...prior,
      entry({
        timestamp: new Date(NOW.getTime() - 3 * 60_000).toISOString(),
        riskScore: 30,
      }),
    ]);
    expect(out.current).toBe(30);
    expect(out.baselineP50).toBe(60);
    expect(out.delta).toBe(-30);
  });
});
