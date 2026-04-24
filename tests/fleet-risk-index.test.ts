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
  return {
    timestamp: NOW.toISOString(),
    toolName: "exec",
    params: {},
    prevHash: "0",
    hash: "h",
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

describe("computeFleetRiskIndex — current (last 15 min max)", () => {
  it("returns max riskScore in the last 15 minutes", () => {
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
  it("excludes entries older than 15 minutes", () => {
    const out = computeFleetRiskIndex([
      entry({
        timestamp: new Date(NOW.getTime() - 16 * 60_000).toISOString(),
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

describe("computeFleetRiskIndex — 24h counts", () => {
  it("counts crit (>=75) and high (50<=s<75) in last 24h", () => {
    const h = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString();
    const out = computeFleetRiskIndex([
      entry({ timestamp: h(1), riskScore: 80 }), // crit
      entry({ timestamp: h(2), riskScore: 75 }), // crit (boundary)
      entry({ timestamp: h(3), riskScore: 50 }), // high (boundary)
      entry({ timestamp: h(4), riskScore: 60 }), // high
      entry({ timestamp: h(5), riskScore: 49 }), // neither
      entry({ timestamp: h(25), riskScore: 90 }), // outside 24h
    ]);
    expect(out.critCount).toBe(2);
    expect(out.highCount).toBe(2);
    expect(out.totalElevated).toBe(4);
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
