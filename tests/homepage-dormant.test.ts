import { describe, expect, it } from "vitest";
import { isDormant } from "../dashboard/src/lib/homepageState";
import type { StatsResponse } from "../dashboard/src/lib/types";

function stats(overrides: Partial<StatsResponse> = {}): StatsResponse {
  return {
    total: 0,
    allowed: 0,
    approved: 0,
    blocked: 0,
    timedOut: 0,
    pending: 0,
    riskBreakdown: { low: 0, medium: 0, high: 0, critical: 0 },
    avgRiskScore: 0,
    peakRiskScore: 0,
    activeAgents: 0,
    activeSessions: 0,
    riskPosture: "calm",
    historicDailyMax: 0,
    yesterdayTotal: 0,
    llmHealth: { recentAttempts: 0, recentFailures: 0, status: "ok" },
    ...overrides,
  };
}

describe("isDormant", () => {
  it("returns null when stats is not yet loaded (undefined)", () => {
    expect(isDormant(undefined)).toBeNull();
  });

  it("returns null when stats is not yet loaded (null)", () => {
    expect(isDormant(null)).toBeNull();
  });

  it("returns true when both total and activeSessions are 0", () => {
    expect(isDormant(stats({ total: 0, activeSessions: 0 }))).toBe(true);
  });

  it("returns false when total > 0", () => {
    expect(isDormant(stats({ total: 1, activeSessions: 0 }))).toBe(false);
  });

  it("returns false when activeSessions > 0", () => {
    expect(isDormant(stats({ total: 0, activeSessions: 1 }))).toBe(false);
  });

  it("returns false when both total and activeSessions are positive", () => {
    expect(isDormant(stats({ total: 12, activeSessions: 2 }))).toBe(false);
  });

  it("ignores other stat fields — only total+activeSessions drive the decision", () => {
    // Even with a high risk posture or llm down, if nothing has happened it's dormant
    expect(
      isDormant(
        stats({
          total: 0,
          activeSessions: 0,
          riskPosture: "critical",
          llmHealth: { recentAttempts: 5, recentFailures: 5, status: "down" },
        }),
      ),
    ).toBe(true);
  });
});
