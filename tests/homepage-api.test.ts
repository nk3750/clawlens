import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditEntry } from "../src/audit/logger";
import {
  computeEnhancedStats,
  computeHistoricDailyMax,
  getAgents,
  getInterventions,
} from "../src/dashboard/api";

/** Build a minimal AuditEntry with overrides. */
function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    timestamp: new Date().toISOString(),
    toolName: "exec",
    params: {},
    prevHash: "0",
    hash: "abc",
    ...overrides,
  };
}

// ── computeHistoricDailyMax ──────────────────────────────

describe("computeHistoricDailyMax", () => {
  it("returns 100 for empty entries", () => {
    expect(computeHistoricDailyMax([])).toBe(100);
  });

  it("returns correct max across multiple days", () => {
    const entries = [
      // Day 1: 3 decision entries
      entry({ timestamp: "2026-04-05T10:00:00Z", decision: "allow" }),
      entry({ timestamp: "2026-04-05T11:00:00Z", decision: "allow" }),
      entry({ timestamp: "2026-04-05T12:00:00Z", decision: "block" }),
      // Day 2: 5 decision entries (max)
      entry({ timestamp: "2026-04-06T10:00:00Z", decision: "allow" }),
      entry({ timestamp: "2026-04-06T11:00:00Z", decision: "allow" }),
      entry({ timestamp: "2026-04-06T12:00:00Z", decision: "allow" }),
      entry({ timestamp: "2026-04-06T13:00:00Z", decision: "allow" }),
      entry({ timestamp: "2026-04-06T14:00:00Z", decision: "block" }),
      // Day 3: 1 decision entry
      entry({ timestamp: "2026-04-07T10:00:00Z", decision: "allow" }),
    ];
    expect(computeHistoricDailyMax(entries)).toBe(5);
  });

  it("only counts decision entries, not result entries", () => {
    const entries = [
      entry({ timestamp: "2026-04-05T10:00:00Z", decision: "allow" }),
      entry({ timestamp: "2026-04-05T11:00:00Z" }), // result entry, no decision
      entry({ timestamp: "2026-04-05T12:00:00Z", executionResult: "success" }), // result
    ];
    expect(computeHistoricDailyMax(entries)).toBe(1);
  });
});

// ── computeEnhancedStats with date ──────────────────────

describe("computeEnhancedStats with date param", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 7, 14, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("filters to specific calendar day when date provided", () => {
    const entries = [
      entry({
        timestamp: "2026-04-05T10:00:00Z",
        decision: "allow",
        riskScore: 10,
        riskTier: "low",
      }),
      entry({
        timestamp: "2026-04-05T11:00:00Z",
        decision: "block",
        riskScore: 60,
        riskTier: "high",
      }),
      entry({
        timestamp: "2026-04-06T10:00:00Z",
        decision: "allow",
        riskScore: 5,
        riskTier: "low",
      }),
      entry({
        timestamp: "2026-04-07T10:00:00Z",
        decision: "allow",
        riskScore: 20,
        riskTier: "low",
      }),
    ];

    const stats = computeEnhancedStats(entries, "2026-04-05");
    expect(stats.total).toBe(2);
    expect(stats.blocked).toBe(1);
    expect(stats.allowed).toBe(1);
    expect(stats.peakRiskScore).toBe(60);
  });

  it("without date uses rolling 24h (existing behavior)", () => {
    const entries = [
      entry({
        timestamp: "2026-04-07T10:00:00Z",
        decision: "allow",
        riskScore: 10,
        riskTier: "low",
      }),
      entry({
        timestamp: "2026-04-07T12:00:00Z",
        decision: "allow",
        riskScore: 20,
        riskTier: "low",
      }),
      // Old entry outside 24h window
      entry({
        timestamp: "2026-04-05T10:00:00Z",
        decision: "allow",
        riskScore: 90,
        riskTier: "critical",
      }),
    ];

    const stats = computeEnhancedStats(entries);
    expect(stats.total).toBe(2);
    expect(stats.peakRiskScore).toBe(20);
  });

  it("past-day activeAgents counts distinct agents that day", () => {
    const entries = [
      entry({ timestamp: "2026-04-05T10:00:00Z", decision: "allow", agentId: "alpha" }),
      entry({ timestamp: "2026-04-05T11:00:00Z", decision: "allow", agentId: "alpha" }),
      entry({ timestamp: "2026-04-05T12:00:00Z", decision: "allow", agentId: "beta" }),
    ];

    const stats = computeEnhancedStats(entries, "2026-04-05");
    expect(stats.activeAgents).toBe(2);
  });

  it("past-day activeSessions counts distinct sessions that day", () => {
    const entries = [
      entry({ timestamp: "2026-04-05T10:00:00Z", decision: "allow", sessionKey: "s1" }),
      entry({ timestamp: "2026-04-05T11:00:00Z", decision: "allow", sessionKey: "s1" }),
      entry({ timestamp: "2026-04-05T12:00:00Z", decision: "allow", sessionKey: "s2" }),
    ];

    const stats = computeEnhancedStats(entries, "2026-04-05");
    expect(stats.activeSessions).toBe(2);
  });

  it("includes historicDailyMax in response", () => {
    const entries = [
      entry({ timestamp: "2026-04-05T10:00:00Z", decision: "allow" }),
      entry({ timestamp: "2026-04-05T11:00:00Z", decision: "allow" }),
      entry({ timestamp: "2026-04-06T10:00:00Z", decision: "allow" }),
    ];

    const stats = computeEnhancedStats(entries);
    expect(stats.historicDailyMax).toBe(2);
  });
});

// ── getAgents with date ──────────────────────────────────

describe("getAgents with date param", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 7, 14, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns only agents active on that day", () => {
    const entries = [
      entry({ timestamp: "2026-04-05T10:00:00Z", decision: "allow", agentId: "alpha" }),
      entry({ timestamp: "2026-04-05T11:00:00Z", decision: "allow", agentId: "beta" }),
      entry({ timestamp: "2026-04-06T10:00:00Z", decision: "allow", agentId: "gamma" }),
    ];

    const agents = getAgents(entries, "2026-04-05");
    expect(agents).toHaveLength(2);
    expect(agents.map((a) => a.id).sort()).toEqual(["alpha", "beta"]);
  });

  it("sets all agents to idle for past day", () => {
    const entries = [
      entry({ timestamp: "2026-04-05T10:00:00Z", decision: "allow", agentId: "alpha" }),
    ];

    const agents = getAgents(entries, "2026-04-05");
    expect(agents[0].status).toBe("idle");
  });

  it("without date uses existing behavior", () => {
    const entries = [
      // Active within 5 minutes
      entry({
        timestamp: new Date(2026, 3, 7, 13, 57, 0).toISOString(),
        decision: "allow",
        agentId: "alpha",
      }),
    ];

    const agents = getAgents(entries);
    expect(agents[0].status).toBe("active");
  });

  it("past-day agents omitted if no decision entries", () => {
    const entries = [
      // Only result entries, no decision
      entry({ timestamp: "2026-04-05T10:00:00Z", agentId: "alpha", executionResult: "success" }),
      entry({ timestamp: "2026-04-05T11:00:00Z", decision: "allow", agentId: "beta" }),
    ];

    const agents = getAgents(entries, "2026-04-05");
    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe("beta");
  });
});

// ── getInterventions ─────────────────────────────────────

describe("getInterventions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 7, 14, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns only blocked and approval_required entries", () => {
    const entries = [
      entry({ timestamp: "2026-04-07T10:00:00Z", decision: "allow", agentId: "a" }),
      entry({ timestamp: "2026-04-07T11:00:00Z", decision: "block", agentId: "b", riskScore: 70 }),
      entry({
        timestamp: "2026-04-07T12:00:00Z",
        decision: "approval_required",
        agentId: "c",
        riskScore: 55,
      }),
      entry({ timestamp: "2026-04-07T13:00:00Z", decision: "allow", agentId: "d" }),
    ];

    const result = getInterventions(entries);
    expect(result).toHaveLength(2);
    expect(result[0].decision).toBe("approval_required"); // most recent first
    expect(result[1].decision).toBe("block");
  });

  it("sorts by timestamp descending", () => {
    const entries = [
      entry({ timestamp: "2026-04-07T10:00:00Z", decision: "block", agentId: "a" }),
      entry({ timestamp: "2026-04-07T13:00:00Z", decision: "block", agentId: "b" }),
      entry({ timestamp: "2026-04-07T11:00:00Z", decision: "block", agentId: "c" }),
    ];

    const result = getInterventions(entries);
    expect(result[0].agentId).toBe("b");
    expect(result[1].agentId).toBe("c");
    expect(result[2].agentId).toBe("a");
  });

  it("limits to 20 entries", () => {
    const entries = Array.from({ length: 30 }, (_, i) =>
      entry({
        timestamp: new Date(2026, 3, 7, 8 + Math.floor(i / 6), i * 2, 0).toISOString(),
        decision: "block",
        agentId: `agent-${i}`,
      }),
    );

    const result = getInterventions(entries);
    expect(result).toHaveLength(20);
  });

  it("filters to specific day when date provided", () => {
    const entries = [
      entry({ timestamp: "2026-04-05T10:00:00Z", decision: "block", agentId: "a" }),
      entry({ timestamp: "2026-04-06T10:00:00Z", decision: "block", agentId: "b" }),
      entry({ timestamp: "2026-04-07T10:00:00Z", decision: "block", agentId: "c" }),
    ];

    const result = getInterventions(entries, "2026-04-05");
    expect(result).toHaveLength(1);
    expect(result[0].agentId).toBe("a");
  });

  it("returns empty array for quiet day", () => {
    const entries = [
      entry({ timestamp: "2026-04-07T10:00:00Z", decision: "allow", agentId: "a" }),
      entry({ timestamp: "2026-04-07T11:00:00Z", decision: "allow", agentId: "b" }),
    ];

    const result = getInterventions(entries);
    expect(result).toHaveLength(0);
  });

  it("uses LLM-adjusted scores when available", () => {
    const entries = [
      entry({
        timestamp: "2026-04-07T10:00:00Z",
        decision: "block",
        agentId: "a",
        toolCallId: "tc1",
        riskScore: 50,
      }),
      entry({
        timestamp: "2026-04-07T10:00:01Z",
        toolName: "exec",
        params: {},
        refToolCallId: "tc1",
        llmEvaluation: {
          adjustedScore: 75,
          reasoning: "test",
          tags: [],
          confidence: "high",
          patterns: [],
        },
        prevHash: "0",
        hash: "abc",
      }),
    ];

    const result = getInterventions(entries);
    expect(result).toHaveLength(1);
    expect(result[0].riskScore).toBe(75); // LLM-adjusted, not original 50
  });
});
