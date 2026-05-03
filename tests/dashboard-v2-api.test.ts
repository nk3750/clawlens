import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditEntry } from "../src/audit/logger";
import {
  computeEnhancedStats,
  deriveAttentionFlags,
  getAgentDetail,
  getAgents,
  getAttention,
  getRecentEntries,
  getSessionDetail,
  getSessions,
} from "../src/dashboard/api";
import { AttentionStore } from "../src/dashboard/attention-state";

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

describe("computeEnhancedStats", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-29T14:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("includes base stats fields and riskPosture", () => {
    const entries = [entry({ timestamp: "2026-03-29T10:00:00Z", decision: "allow" })];
    const stats = computeEnhancedStats(entries);
    expect(stats.allowed).toBe(1);
    expect(stats.total).toBe(1);
    expect(stats.riskBreakdown).toBeDefined();
    expect(stats.avgRiskScore).toBeDefined();
    expect(stats.peakRiskScore).toBeDefined();
    expect(stats.activeAgents).toBeDefined();
    expect(stats.activeSessions).toBeDefined();
    expect(stats.riskPosture).toBeDefined();
  });

  it("computes risk breakdown from today entries", () => {
    const entries = [
      entry({
        timestamp: "2026-03-29T10:00:00Z",
        decision: "allow",
        riskTier: "low",
        riskScore: 10,
      }),
      entry({
        timestamp: "2026-03-29T10:01:00Z",
        decision: "allow",
        riskTier: "medium",
        riskScore: 40,
      }),
      entry({
        timestamp: "2026-03-29T10:02:00Z",
        decision: "block",
        riskTier: "high",
        riskScore: 70,
      }),
      entry({
        timestamp: "2026-03-29T10:03:00Z",
        decision: "block",
        riskTier: "critical",
        riskScore: 90,
      }),
    ];
    const stats = computeEnhancedStats(entries);
    expect(stats.riskBreakdown).toEqual({
      low: 1,
      medium: 1,
      high: 1,
      critical: 1,
    });
    expect(stats.avgRiskScore).toBe(53); // (10+40+70+90)/4 = 52.5 → 53
    expect(stats.peakRiskScore).toBe(90);
  });

  it("returns zero risk stats when no risk data", () => {
    const entries = [entry({ timestamp: "2026-03-29T10:00:00Z", decision: "allow" })];
    const stats = computeEnhancedStats(entries);
    expect(stats.riskBreakdown).toEqual({
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    });
    expect(stats.avgRiskScore).toBe(0);
    expect(stats.peakRiskScore).toBe(0);
  });

  it("counts active agents and sessions within threshold", () => {
    const entries = [
      entry({
        timestamp: "2026-03-29T13:56:00Z",
        decision: "allow",
        agentId: "bot-1",
        sessionKey: "s1",
      }),
      entry({
        timestamp: "2026-03-29T13:57:00Z",
        decision: "allow",
        agentId: "bot-2",
        sessionKey: "s2",
      }),
      // Old entry — not active (more than 5 min ago)
      entry({
        timestamp: "2026-03-29T10:00:00Z",
        decision: "allow",
        agentId: "bot-3",
        sessionKey: "s3",
      }),
    ];
    const stats = computeEnhancedStats(entries);
    expect(stats.activeAgents).toBe(2);
    expect(stats.activeSessions).toBe(2);
  });

  it("returns zeros for empty entries", () => {
    const stats = computeEnhancedStats([]);
    expect(stats.total).toBe(0);
    expect(stats.activeAgents).toBe(0);
    expect(stats.riskBreakdown).toEqual({
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    });
  });
});

describe("getAgents", () => {
  it("returns empty array for no entries", () => {
    expect(getAgents([])).toEqual([]);
  });

  it("groups entries by agentId", () => {
    const entries = [
      entry({ agentId: "bot-1", decision: "allow" }),
      entry({ agentId: "bot-1", decision: "block" }),
      entry({ agentId: "bot-2", decision: "allow" }),
    ];
    const agents = getAgents(entries);
    expect(agents).toHaveLength(2);
    const ids = agents.map((a) => a.id);
    expect(ids).toContain("bot-1");
    expect(ids).toContain("bot-2");
  });

  it("defaults agentId to 'default' when missing", () => {
    const entries = [entry({ decision: "allow" })];
    const agents = getAgents(entries);
    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe("default");
    expect(agents[0].name).toBe("default");
  });

  it("computes risk stats per agent", () => {
    const entries = [
      entry({
        agentId: "bot-1",
        decision: "allow",
        riskScore: 20,
      }),
      entry({
        agentId: "bot-1",
        decision: "allow",
        riskScore: 60,
      }),
    ];
    const agents = getAgents(entries);
    const bot1 = agents.find((a) => a.id === "bot-1")!;
    expect(bot1.avgRiskScore).toBe(40);
    expect(bot1.peakRiskScore).toBe(60);
  });

  it("marks agents as idle when last activity is old", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-29T14:00:00Z"));

    const entries = [
      entry({
        agentId: "bot-1",
        decision: "allow",
        timestamp: "2026-03-29T10:00:00Z",
      }),
    ];
    const agents = getAgents(entries);
    expect(agents[0].status).toBe("idle");

    vi.useRealTimers();
  });

  it("sorts active agents first", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-29T14:00:00Z"));

    const entries = [
      entry({
        agentId: "old-bot",
        decision: "allow",
        timestamp: "2026-03-29T10:00:00Z",
      }),
      entry({
        agentId: "new-bot",
        decision: "allow",
        timestamp: "2026-03-29T13:58:00Z",
      }),
    ];
    const agents = getAgents(entries);
    expect(agents[0].id).toBe("new-bot");
    expect(agents[0].status).toBe("active");
    expect(agents[1].id).toBe("old-bot");
    expect(agents[1].status).toBe("idle");

    vi.useRealTimers();
  });
});

describe("getSessions", () => {
  it("groups entries by sessionKey", () => {
    const entries = [
      entry({
        sessionKey: "s1",
        agentId: "bot-1",
        decision: "allow",
        timestamp: "2026-03-29T10:00:00Z",
      }),
      entry({
        sessionKey: "s1",
        agentId: "bot-1",
        decision: "block",
        timestamp: "2026-03-29T10:01:00Z",
      }),
      entry({
        sessionKey: "s2",
        agentId: "bot-1",
        decision: "allow",
        timestamp: "2026-03-29T11:00:00Z",
      }),
    ];
    const result = getSessions(entries);
    expect(result.total).toBe(2);
    expect(result.sessions).toHaveLength(2);
  });

  it("filters by agentId", () => {
    const entries = [
      entry({
        sessionKey: "s1",
        agentId: "bot-1",
        decision: "allow",
        timestamp: "2026-03-29T10:00:00Z",
      }),
      entry({
        sessionKey: "s2",
        agentId: "bot-2",
        decision: "allow",
        timestamp: "2026-03-29T11:00:00Z",
      }),
    ];
    const result = getSessions(entries, "bot-1");
    expect(result.total).toBe(1);
    expect(result.sessions[0].sessionKey).toBe("s1");
  });

  it("paginates results", () => {
    const entries = [
      entry({
        sessionKey: "s1",
        agentId: "bot-1",
        decision: "allow",
        timestamp: "2026-03-29T10:00:00Z",
      }),
      entry({
        sessionKey: "s2",
        agentId: "bot-1",
        decision: "allow",
        timestamp: "2026-03-29T11:00:00Z",
      }),
      entry({
        sessionKey: "s3",
        agentId: "bot-1",
        decision: "allow",
        timestamp: "2026-03-29T12:00:00Z",
      }),
    ];
    const result = getSessions(entries, undefined, 2, 0);
    expect(result.sessions).toHaveLength(2);
    expect(result.total).toBe(3);
  });

  it("skips entries without sessionKey", () => {
    const entries = [entry({ decision: "allow", timestamp: "2026-03-29T10:00:00Z" })];
    const result = getSessions(entries);
    expect(result.total).toBe(0);
  });

  it("computes session risk stats", () => {
    const entries = [
      entry({
        sessionKey: "s1",
        decision: "allow",
        riskScore: 20,
        timestamp: "2026-03-29T10:00:00Z",
      }),
      entry({
        sessionKey: "s1",
        decision: "block",
        riskScore: 80,
        timestamp: "2026-03-29T10:01:00Z",
      }),
    ];
    const result = getSessions(entries);
    expect(result.sessions[0].avgRisk).toBe(50);
    expect(result.sessions[0].peakRisk).toBe(80);
  });

  it("computes session duration", () => {
    const entries = [
      entry({
        sessionKey: "s1",
        decision: "allow",
        timestamp: "2026-03-29T10:00:00Z",
      }),
      entry({
        sessionKey: "s1",
        decision: "allow",
        timestamp: "2026-03-29T10:05:00Z",
      }),
    ];
    const result = getSessions(entries);
    expect(result.sessions[0].duration).toBe(5 * 60 * 1000); // 5 minutes in ms
  });
});

describe("getSessionDetail", () => {
  it("returns null for unknown session", () => {
    expect(getSessionDetail([], "nonexistent")).toBeNull();
  });

  it("returns session info with entries in chronological order", () => {
    const entries = [
      entry({
        sessionKey: "s1",
        agentId: "bot-1",
        decision: "allow",
        toolName: "read",
        timestamp: "2026-03-29T10:00:00Z",
        riskScore: 10,
      }),
      entry({
        sessionKey: "s1",
        agentId: "bot-1",
        decision: "block",
        toolName: "exec",
        timestamp: "2026-03-29T10:01:00Z",
        riskScore: 70,
      }),
      entry({
        sessionKey: "s2",
        agentId: "bot-2",
        decision: "allow",
        timestamp: "2026-03-29T11:00:00Z",
      }),
    ];
    const result = getSessionDetail(entries, "s1");
    expect(result).not.toBeNull();
    expect(result!.session.sessionKey).toBe("s1");
    expect(result!.session.agentId).toBe("bot-1");
    expect(result!.session.toolCallCount).toBe(2);
    expect(result!.entries).toHaveLength(2);
    expect(result!.entries[0].toolName).toBe("read"); // chronological
    expect(result!.entries[1].toolName).toBe("exec");
  });

  it("only includes entries from the requested session", () => {
    const entries = [
      entry({
        sessionKey: "s1",
        decision: "allow",
        timestamp: "2026-03-29T10:00:00Z",
      }),
      entry({
        sessionKey: "s2",
        decision: "allow",
        timestamp: "2026-03-29T11:00:00Z",
      }),
    ];
    const result = getSessionDetail(entries, "s1");
    expect(result!.entries).toHaveLength(1);
  });
});

describe("getAgentDetail", () => {
  it("returns null for unknown agent", () => {
    expect(getAgentDetail([], "nonexistent")).toBeNull();
  });

  it("returns agent info with recent activity and sessions", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-29T14:00:00Z"));

    const entries = [
      entry({
        agentId: "bot-1",
        sessionKey: "s1",
        decision: "allow",
        toolName: "read",
        timestamp: "2026-03-29T10:00:00Z",
      }),
      entry({
        agentId: "bot-1",
        sessionKey: "s1",
        decision: "block",
        toolName: "exec",
        timestamp: "2026-03-29T10:01:00Z",
      }),
    ];
    const result = getAgentDetail(entries, "bot-1");
    expect(result).not.toBeNull();
    expect(result!.agent.id).toBe("bot-1");
    expect(result!.recentActivity).toHaveLength(2);
    expect(result!.currentSessionActivity).toBeDefined();
    expect(result!.sessions).toHaveLength(1);
    expect(result!.totalSessions).toBe(1);

    vi.useRealTimers();
  });

  it("returns recent activity in reverse chronological order", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-29T14:00:00Z"));

    const entries = [
      entry({
        agentId: "bot-1",
        decision: "allow",
        toolName: "read",
        timestamp: "2026-03-29T10:00:00Z",
      }),
      entry({
        agentId: "bot-1",
        decision: "block",
        toolName: "exec",
        timestamp: "2026-03-29T10:01:00Z",
      }),
    ];
    const result = getAgentDetail(entries, "bot-1");
    expect(result!.recentActivity[0].toolName).toBe("exec"); // most recent first
    expect(result!.recentActivity[1].toolName).toBe("read");

    vi.useRealTimers();
  });

  it("limits recent activity to 200 entries", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-29T14:00:00Z"));

    const entries = Array.from({ length: 250 }, (_, i) =>
      entry({
        agentId: "bot-1",
        decision: "allow",
        timestamp: `2026-03-29T${String(10 + Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00Z`,
      }),
    );
    const result = getAgentDetail(entries, "bot-1");
    expect(result!.recentActivity.length).toBeLessThanOrEqual(200);

    vi.useRealTimers();
  });

  it("excludes other agents' entries", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-29T14:00:00Z"));

    const entries = [
      entry({
        agentId: "bot-1",
        decision: "allow",
        timestamp: "2026-03-29T10:00:00Z",
      }),
      entry({
        agentId: "bot-2",
        decision: "allow",
        timestamp: "2026-03-29T10:01:00Z",
      }),
    ];
    const result = getAgentDetail(entries, "bot-1");
    expect(result!.recentActivity).toHaveLength(1);

    vi.useRealTimers();
  });

  it("includes riskTrend sorted chronologically", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-29T14:00:00Z"));

    const entries = [
      entry({
        agentId: "bot-1",
        sessionKey: "s1",
        decision: "allow",
        toolName: "read",
        riskScore: 10,
        timestamp: "2026-03-29T10:00:00Z",
      }),
      entry({
        agentId: "bot-1",
        sessionKey: "s1",
        decision: "allow",
        toolName: "exec",
        riskScore: 50,
        timestamp: "2026-03-29T12:00:00Z",
      }),
      entry({
        agentId: "bot-1",
        sessionKey: "s1",
        decision: "block",
        toolName: "exec",
        riskScore: 80,
        timestamp: "2026-03-29T11:00:00Z",
      }),
    ];
    const result = getAgentDetail(entries, "bot-1");
    expect(result!.riskTrend).toHaveLength(3);
    // Should be sorted chronologically (oldest first)
    expect(result!.riskTrend[0].timestamp).toBe("2026-03-29T10:00:00Z");
    expect(result!.riskTrend[1].timestamp).toBe("2026-03-29T11:00:00Z");
    expect(result!.riskTrend[2].timestamp).toBe("2026-03-29T12:00:00Z");
    expect(result!.riskTrend[0].score).toBe(10);
    expect(result!.riskTrend[0].toolName).toBe("read");

    vi.useRealTimers();
  });

  it("riskTrend uses LLM-adjusted scores when available", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-29T14:00:00Z"));

    const entries = [
      entry({
        agentId: "bot-1",
        decision: "allow",
        toolName: "exec",
        toolCallId: "tc_1",
        riskScore: 70,
        timestamp: "2026-03-29T10:00:00Z",
      }),
      // LLM eval entry that adjusts tc_1
      entry({
        agentId: "bot-1",
        toolName: "exec",
        refToolCallId: "tc_1",
        llmEvaluation: {
          adjustedScore: 25,
          reasoning: "Health check",
          tags: [],
          confidence: "high",
          patterns: [],
        },
        timestamp: "2026-03-29T10:00:05Z",
      }),
    ];
    const result = getAgentDetail(entries, "bot-1");
    expect(result!.riskTrend).toHaveLength(1);
    expect(result!.riskTrend[0].score).toBe(25); // LLM-adjusted
    vi.useRealTimers();
  });

  it("riskTrend includes sessionKey and toolCallId", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-29T14:00:00Z"));

    const entries = [
      entry({
        agentId: "bot-1",
        sessionKey: "s1",
        toolCallId: "tc_1",
        decision: "allow",
        toolName: "exec",
        riskScore: 40,
        timestamp: "2026-03-29T10:00:00Z",
      }),
    ];
    const result = getAgentDetail(entries, "bot-1");
    expect(result!.riskTrend[0].sessionKey).toBe("s1");
    expect(result!.riskTrend[0].toolCallId).toBe("tc_1");

    vi.useRealTimers();
  });

  it("riskTrend uses split session keys for cron agents", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-29T14:00:00Z"));

    // Two cron runs with same raw session key, 2h gap (> 30min SESSION_GAP_MS)
    const entries = [
      entry({
        agentId: "bot-1",
        sessionKey: "agent:bot-1:cron:job-001",
        toolCallId: "tc_run1",
        decision: "allow",
        toolName: "exec",
        riskScore: 30,
        timestamp: "2026-03-29T10:00:00Z",
      }),
      entry({
        agentId: "bot-1",
        sessionKey: "agent:bot-1:cron:job-001",
        toolCallId: "tc_run2",
        decision: "allow",
        toolName: "exec",
        riskScore: 50,
        timestamp: "2026-03-29T12:00:00Z", // 2h gap → splits into run #2
      }),
    ];
    const result = getAgentDetail(entries, "bot-1");
    expect(result!.riskTrend).toHaveLength(2);
    // First run keeps the raw key (no suffix)
    expect(result!.riskTrend[0].sessionKey).toBe("agent:bot-1:cron:job-001");
    // Second run gets #2 suffix
    expect(result!.riskTrend[1].sessionKey).toBe("agent:bot-1:cron:job-001#2");

    vi.useRealTimers();
  });

  it("recentActivity uses split session keys for cron agents", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-29T14:00:00Z"));

    const entries = [
      entry({
        agentId: "bot-1",
        sessionKey: "agent:bot-1:cron:job-001",
        toolCallId: "tc_a",
        decision: "allow",
        toolName: "read",
        timestamp: "2026-03-29T10:00:00Z",
      }),
      entry({
        agentId: "bot-1",
        sessionKey: "agent:bot-1:cron:job-001",
        toolCallId: "tc_b",
        decision: "allow",
        toolName: "exec",
        timestamp: "2026-03-29T12:00:00Z", // 2h gap → run #2
      }),
    ];
    const result = getAgentDetail(entries, "bot-1");
    // recentActivity is reverse-chrono, so tc_b (run #2) comes first
    expect(result!.recentActivity[0].sessionKey).toBe("agent:bot-1:cron:job-001#2");
    expect(result!.recentActivity[1].sessionKey).toBe("agent:bot-1:cron:job-001");

    vi.useRealTimers();
  });

  it("recentActivity preserves sessionKey for non-cron sessions", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-29T14:00:00Z"));

    const entries = [
      entry({
        agentId: "bot-1",
        sessionKey: "agent:bot-1:telegram:direct:123",
        toolCallId: "tc_1",
        decision: "allow",
        toolName: "read",
        timestamp: "2026-03-29T10:00:00Z",
      }),
      entry({
        agentId: "bot-1",
        sessionKey: "agent:bot-1:telegram:direct:123",
        toolCallId: "tc_2",
        decision: "allow",
        toolName: "exec",
        timestamp: "2026-03-29T10:01:00Z",
      }),
    ];
    const result = getAgentDetail(entries, "bot-1");
    // Non-cron: no gap splitting, key stays the same
    expect(result!.recentActivity[0].sessionKey).toBe("agent:bot-1:telegram:direct:123");
    expect(result!.recentActivity[1].sessionKey).toBe("agent:bot-1:telegram:direct:123");
    // Same in riskTrend (no scores so riskTrend empty, check sessions instead)
    expect(result!.sessions[0].sessionKey).toBe("agent:bot-1:telegram:direct:123");

    vi.useRealTimers();
  });

  it("currentSessionActivity shows only latest split sub-session for active cron agents", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-29T13:02:00Z")); // 2min after last entry → agent active

    // Two cron runs with same raw session key, 2h gap
    const entries = [
      entry({
        agentId: "bot-1",
        sessionKey: "agent:bot-1:cron:job-001",
        toolCallId: "tc_old",
        decision: "allow",
        toolName: "exec",
        timestamp: "2026-03-29T10:00:00Z", // run 1
      }),
      entry({
        agentId: "bot-1",
        sessionKey: "agent:bot-1:cron:job-001",
        toolCallId: "tc_new1",
        decision: "allow",
        toolName: "read",
        timestamp: "2026-03-29T13:00:00Z", // run 2 (2h gap)
      }),
      entry({
        agentId: "bot-1",
        sessionKey: "agent:bot-1:cron:job-001",
        toolCallId: "tc_new2",
        decision: "allow",
        toolName: "exec",
        timestamp: "2026-03-29T13:01:00Z", // run 2 continued
      }),
    ];
    const result = getAgentDetail(entries, "bot-1");
    // Agent should be active (last entry 1min ago)
    expect(result!.agent.status).toBe("active");
    // currentSessionActivity should only have entries from the latest run (#2)
    expect(result!.currentSessionActivity).toHaveLength(2);
    expect(result!.currentSessionActivity.map((e) => e.toolCallId)).toEqual(
      expect.arrayContaining(["tc_new1", "tc_new2"]),
    );
    // Should NOT include tc_old from run 1
    expect(result!.currentSessionActivity.find((e) => e.toolCallId === "tc_old")).toBeUndefined();

    vi.useRealTimers();
  });

  it("split session keys match between recentActivity and sessions", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-29T14:00:00Z"));

    const entries = [
      entry({
        agentId: "bot-1",
        sessionKey: "agent:bot-1:cron:job-001",
        toolCallId: "tc_1",
        decision: "allow",
        toolName: "exec",
        riskScore: 30,
        timestamp: "2026-03-29T10:00:00Z",
      }),
      entry({
        agentId: "bot-1",
        sessionKey: "agent:bot-1:cron:job-001",
        toolCallId: "tc_2",
        decision: "allow",
        toolName: "exec",
        riskScore: 40,
        timestamp: "2026-03-29T12:00:00Z", // 2h gap → run #2
      }),
      entry({
        agentId: "bot-1",
        sessionKey: "agent:bot-1:cron:job-001",
        toolCallId: "tc_3",
        decision: "allow",
        toolName: "exec",
        riskScore: 20,
        timestamp: "2026-03-29T12:01:00Z", // same run as tc_2
      }),
    ];
    const result = getAgentDetail(entries, "bot-1");

    // Sessions should show both split sessions
    const sessionKeys = result!.sessions.map((s) => s.sessionKey);
    expect(sessionKeys).toContain("agent:bot-1:cron:job-001");
    expect(sessionKeys).toContain("agent:bot-1:cron:job-001#2");

    // Every recentActivity sessionKey should exist in the sessions list
    for (const ra of result!.recentActivity) {
      expect(sessionKeys).toContain(ra.sessionKey);
    }

    // Every riskTrend sessionKey should exist in the sessions list
    for (const rt of result!.riskTrend) {
      expect(sessionKeys).toContain(rt.sessionKey);
    }

    vi.useRealTimers();
  });

  it("filters by range parameter", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-29T14:00:00Z"));

    const entries = [
      entry({
        agentId: "bot-1",
        sessionKey: "s1",
        decision: "allow",
        riskScore: 10,
        timestamp: "2026-03-29T06:00:00Z", // 8h ago — outside 3h window
      }),
      entry({
        agentId: "bot-1",
        sessionKey: "s1",
        decision: "allow",
        riskScore: 50,
        timestamp: "2026-03-29T12:00:00Z", // 2h ago — inside 3h window
      }),
    ];
    const result3h = getAgentDetail(entries, "bot-1", "3h");
    expect(result3h!.riskTrend).toHaveLength(1);
    expect(result3h!.riskTrend[0].score).toBe(50);
    expect(result3h!.recentActivity).toHaveLength(1);

    const result24h = getAgentDetail(entries, "bot-1", "24h");
    expect(result24h!.riskTrend).toHaveLength(2);
    expect(result24h!.recentActivity).toHaveLength(2);

    vi.useRealTimers();
  });

  it("defaults to 24h when range is invalid", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-29T14:00:00Z"));

    const entries = [
      entry({
        agentId: "bot-1",
        decision: "allow",
        riskScore: 10,
        timestamp: "2026-03-29T10:00:00Z",
      }),
    ];
    const result = getAgentDetail(entries, "bot-1", "invalid");
    expect(result!.riskTrend).toHaveLength(1);

    vi.useRealTimers();
  });

  it("riskTrend caps at 200 entries", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-29T14:00:00Z"));

    const entries = Array.from({ length: 250 }, (_, i) =>
      entry({
        agentId: "bot-1",
        decision: "allow",
        riskScore: 10,
        timestamp: `2026-03-29T${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00Z`,
      }),
    );
    const result = getAgentDetail(entries, "bot-1");
    expect(result!.riskTrend.length).toBeLessThanOrEqual(200);
    vi.useRealTimers();
  });
});

// ── New v2 field tests ─────────────────────────────────

describe("computeEnhancedStats — riskPosture", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-29T14:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns calm for low average risk", () => {
    const entries = [
      entry({
        timestamp: "2026-03-29T10:00:00Z",
        decision: "allow",
        riskScore: 15,
        riskTier: "low",
      }),
    ];
    expect(computeEnhancedStats(entries).riskPosture).toBe("calm");
  });

  it("returns elevated for medium average risk", () => {
    const entries = [
      entry({
        timestamp: "2026-03-29T10:00:00Z",
        decision: "allow",
        riskScore: 35,
        riskTier: "medium",
      }),
    ];
    expect(computeEnhancedStats(entries).riskPosture).toBe("elevated");
  });

  it("overrides to high when recent entry has riskScore > 75", () => {
    const entries = [
      entry({
        timestamp: "2026-03-29T10:00:00Z",
        decision: "allow",
        riskScore: 10,
        riskTier: "low",
      }),
      entry({
        timestamp: "2026-03-29T13:30:00Z",
        decision: "allow",
        riskScore: 80,
        riskTier: "critical",
      }),
    ];
    // avg = 45, base posture = elevated, but override to high due to recent >75
    const posture = computeEnhancedStats(entries).riskPosture;
    expect(posture).toBe("high");
  });

  it("overrides to critical when recent block", () => {
    const entries = [
      entry({
        timestamp: "2026-03-29T10:00:00Z",
        decision: "allow",
        riskScore: 10,
        riskTier: "low",
      }),
      entry({
        timestamp: "2026-03-29T13:45:00Z",
        decision: "block",
        riskScore: 90,
        riskTier: "critical",
      }),
    ];
    expect(computeEnhancedStats(entries).riskPosture).toBe("critical");
  });
});

describe("getAgents — new fields", () => {
  it("detects scheduled mode from cron session key", () => {
    const entries = [
      entry({
        agentId: "scanner",
        sessionKey: "agent:scanner:cron:health-check-001",
        decision: "allow",
        timestamp: "2026-03-29T10:00:00Z",
      }),
    ];
    const agents = getAgents(entries);
    const scanner = agents.find((a) => a.id === "scanner")!;
    expect(scanner.mode).toBe("scheduled");
  });

  it("populates schedule cadence from run starts (not per-entry timestamps)", () => {
    // Three distinct cron runs, each with 4 tool calls ~1s apart.
    // Without run-start dedupe, the median interval would be ~1s
    // and we'd report "every 1s". Correct output: every 8h.
    const runStarts = ["2026-04-16T07:05:00Z", "2026-04-16T15:05:00Z", "2026-04-16T23:05:00Z"];
    const entries = runStarts.flatMap((start, runIdx) => {
      const base = new Date(start).getTime();
      return [0, 1, 2, 3].map((i) =>
        entry({
          agentId: "seo-growth",
          sessionKey: "agent:seo-growth:cron:trending-watch-001",
          decision: "allow",
          toolName: "exec",
          riskScore: 10,
          timestamp: new Date(base + i * 1000).toISOString(),
          toolCallId: `run${runIdx}-${i}`,
        }),
      );
    });
    const agents = getAgents(entries);
    const seo = agents.find((a) => a.id === "seo-growth")!;
    expect(seo.mode).toBe("scheduled");
    expect(seo.schedule).toBe("every 8h");
  });

  it("handles rapid-fire cron (minute-level) without collapsing runs", () => {
    // 5 runs at 1-minute intervals, each with 3 within-run tool calls.
    const runStarts = Array.from({ length: 5 }, (_, i) =>
      new Date(Date.parse("2026-04-16T12:00:00Z") + i * 60_000).toISOString(),
    );
    const entries = runStarts.flatMap((start, runIdx) => {
      const base = new Date(start).getTime();
      return [0, 1, 2].map((k) =>
        entry({
          agentId: "watcher",
          sessionKey: "agent:watcher:cron:tick",
          decision: "allow",
          toolName: "exec",
          riskScore: 5,
          timestamp: new Date(base + k * 500).toISOString(),
          toolCallId: `r${runIdx}-${k}`,
        }),
      );
    });
    const agents = getAgents(entries);
    const watcher = agents.find((a) => a.id === "watcher")!;
    expect(watcher.schedule).toBe("every 1m");
  });

  it("leaves schedule undefined for interactive agents", () => {
    const entries = [
      entry({
        agentId: "main",
        sessionKey: "agent:main:telegram:direct:1234",
        decision: "allow",
        timestamp: "2026-03-29T10:00:00Z",
      }),
    ];
    const agents = getAgents(entries);
    expect(agents[0].schedule).toBeUndefined();
  });

  it("detects interactive mode from telegram session key", () => {
    const entries = [
      entry({
        agentId: "main",
        sessionKey: "agent:main:telegram:direct:1234",
        decision: "allow",
        timestamp: "2026-03-29T10:00:00Z",
      }),
    ];
    const agents = getAgents(entries);
    expect(agents[0].mode).toBe("interactive");
  });

  it("defaults to interactive when no cron sessions", () => {
    const entries = [
      entry({
        agentId: "bot-1",
        sessionKey: "s1",
        decision: "allow",
        timestamp: "2026-03-29T10:00:00Z",
      }),
    ];
    const agents = getAgents(entries);
    expect(agents[0].mode).toBe("interactive");
  });

  it("provides currentContext from session key", () => {
    const entries = [
      entry({
        agentId: "social",
        sessionKey: "agent:social:cron:trend-scan-tweet-006",
        decision: "allow",
        timestamp: "2026-03-29T10:00:00Z",
      }),
    ];
    const agents = getAgents(entries);
    expect(agents[0].currentContext).toBe("Cron: Trend scan tweet");
  });

  it("computes activityBreakdown", () => {
    const entries = [
      entry({
        agentId: "bot-1",
        sessionKey: "s1",
        toolName: "read",
        decision: "allow",
        timestamp: "2026-03-29T10:00:00Z",
      }),
      entry({
        agentId: "bot-1",
        sessionKey: "s1",
        toolName: "read",
        decision: "allow",
        timestamp: "2026-03-29T10:01:00Z",
      }),
      entry({
        agentId: "bot-1",
        sessionKey: "s1",
        toolName: "exec",
        decision: "allow",
        timestamp: "2026-03-29T10:02:00Z",
      }),
    ];
    const agents = getAgents(entries);
    const bot = agents[0];
    expect(bot.activityBreakdown.exploring).toBe(67);
    // bare exec (no params.command) → scripts fallback under the new taxonomy
    expect(bot.activityBreakdown.scripts).toBe(33);
  });

  it("computes latestAction", () => {
    const entries = [
      entry({
        agentId: "bot-1",
        decision: "allow",
        toolName: "read",
        params: { path: "config.yaml" },
        timestamp: "2026-03-29T10:00:00Z",
      }),
      entry({
        agentId: "bot-1",
        decision: "allow",
        toolName: "exec",
        params: { command: "npm test" },
        timestamp: "2026-03-29T10:01:00Z",
      }),
    ];
    const agents = getAgents(entries);
    expect(agents[0].latestAction).toBe("Ran npm test");
    expect(agents[0].latestActionTime).toBe("2026-03-29T10:01:00Z");
  });

  it("computes riskPosture per agent", () => {
    const entries = [
      entry({
        agentId: "safe-bot",
        sessionKey: "s1",
        decision: "allow",
        riskScore: 10,
        timestamp: "2026-03-29T10:00:00Z",
      }),
    ];
    const agents = getAgents(entries);
    expect(agents[0].riskPosture).toBe("calm");
  });

  it("sets needsAttention from caller-provided attentionAgents Set", () => {
    const entries = [
      entry({
        agentId: "bot-1",
        decision: "block",
        toolName: "exec",
        riskScore: 90,
        timestamp: "2026-03-29T13:45:00Z",
      }),
    ];
    const attentionAgents = new Set(["bot-1"]);
    const attentionReasons = new Map([["bot-1", "Blocked: exec"]]);
    const agents = getAgents(entries, undefined, attentionAgents, attentionReasons);
    expect(agents[0].needsAttention).toBe(true);
    expect(agents[0].attentionReason).toBe("Blocked: exec");
  });

  it("sets attentionReason from attentionReasons Map for high-risk inbox membership", () => {
    const entries = [
      entry({
        agentId: "bot-1",
        decision: "allow",
        riskScore: 80,
        timestamp: "2026-03-29T10:00:00Z",
      }),
    ];
    const attentionAgents = new Set(["bot-1"]);
    const attentionReasons = new Map([["bot-1", "High risk activity detected"]]);
    const agents = getAgents(entries, undefined, attentionAgents, attentionReasons);
    expect(agents[0].needsAttention).toBe(true);
    expect(agents[0].attentionReason).toBe("High risk activity detected");
  });

  it("does NOT flip needsAttention from peakRisk alone when caller omits inbox membership", () => {
    // Regression guard for #13: getAgents previously hard-coded peakRisk >= 75
    // as a today-mode rule, so a high-risk entry kept the agent flagged forever
    // even after the operator ack'd the inbox row. The fix: needsAttention is
    // now derived from the caller-provided Set, never from local heuristics.
    const entries = [
      entry({
        agentId: "bot-1",
        decision: "allow",
        riskScore: 80,
        timestamp: "2026-03-29T10:00:00Z",
      }),
    ];
    const agents = getAgents(entries);
    expect(agents[0].needsAttention).toBe(false);
    expect(agents[0].attentionReason).toBeUndefined();
  });

  it("needsAttention false when all is calm and no inbox membership", () => {
    const entries = [
      entry({
        agentId: "bot-1",
        decision: "allow",
        riskScore: 10,
        timestamp: "2026-03-29T10:00:00Z",
      }),
    ];
    const agents = getAgents(entries);
    expect(agents[0].needsAttention).toBe(false);
    expect(agents[0].attentionReason).toBeUndefined();
  });
});

describe("getAgents — needsAttention derived from inbox (#13 fix)", () => {
  // Integration: prove that getAttention's ack-and-window awareness flows
  // through deriveAttentionFlags into getAgents, so once the operator ack's
  // an inbox row the corresponding agent stops carrying needsAttention=true.
  function tmpStore(): AttentionStore {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawlens-needsattn-"));
    return new AttentionStore(path.join(dir, "attention.jsonl"));
  }

  beforeEach(() => {
    vi.useFakeTimers();
    // Within HIGH_RISK_WINDOW_MS (30 min) of the entry timestamps below.
    vi.setSystemTime(new Date("2026-04-17T12:10:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("flips needsAttention false when all high-risk entries are ack'd", () => {
    // Headline bug: peakRisk:80 today + every related toolCallId acked.
    // Pre-fix: needsAttention=true (peakRisk>=75 rule fires regardless).
    // Post-fix: needsAttention=false (inbox-derived; ack hides the row).
    const entries: AuditEntry[] = [
      entry({
        agentId: "bot-1",
        decision: "allow",
        toolName: "exec",
        toolCallId: "tc1",
        riskScore: 80,
        timestamp: "2026-04-17T12:00:00Z",
      }),
    ];
    const store = tmpStore();
    store.append({
      id: AttentionStore.generateId(),
      scope: { kind: "entry", toolCallId: "tc1" },
      ackedAt: "2026-04-17T12:05:00Z",
      action: "ack",
    });

    const att = getAttention(entries, undefined, store);
    expect(att.highRisk).toHaveLength(0);
    const { agents: attentionAgents, reasons: attentionReasons } = deriveAttentionFlags(att);

    const result = getAgents(entries, undefined, attentionAgents, attentionReasons);
    const bot = result.find((a) => a.id === "bot-1")!;
    expect(bot.needsAttention).toBe(false);
    expect(bot.attentionReason).toBeUndefined();
  });

  it("flips needsAttention true with 'High risk activity detected' for unack'd peak entry", () => {
    const entries: AuditEntry[] = [
      entry({
        agentId: "bot-1",
        decision: "allow",
        toolName: "exec",
        toolCallId: "tc1",
        riskScore: 80,
        timestamp: "2026-04-17T12:00:00Z",
      }),
    ];

    const att = getAttention(entries, undefined, undefined);
    expect(att.highRisk).toHaveLength(1);
    const { agents: attentionAgents, reasons: attentionReasons } = deriveAttentionFlags(att);

    const result = getAgents(entries, undefined, attentionAgents, attentionReasons);
    const bot = result.find((a) => a.id === "bot-1")!;
    expect(bot.needsAttention).toBe(true);
    expect(bot.attentionReason).toBe("High risk activity detected");
  });

  it("past-day mode keeps the legacy block/denied rule (no inbox in history view)", () => {
    // getAttention's windows are now-relative — past-day requests cannot use
    // them. The fix preserves the original block/denied rule for past-day so
    // historical drilldowns still flag the day on which something was blocked.
    const entries: AuditEntry[] = [
      entry({
        agentId: "bot-1",
        decision: "block",
        toolName: "exec",
        toolCallId: "tc-past",
        riskScore: 90,
        timestamp: "2026-04-10T13:45:00Z",
      }),
    ];

    const result = getAgents(entries, "2026-04-10");
    const bot = result.find((a) => a.id === "bot-1")!;
    expect(bot.needsAttention).toBe(true);
    expect(bot.attentionReason).toBe("Blocked: exec");
  });
});

describe("deriveAttentionFlags — bucket priority", () => {
  // Routes.ts orchestration: when an agent appears in multiple buckets, the
  // strongest reason wins. Priority: pending → blocked → agentAttention →
  // highRisk → allowNotify (per #13 spec).
  it("picks pending reason over blocked when both fire for same agent", () => {
    const att = {
      pending: [
        {
          kind: "pending" as const,
          toolCallId: "tc1",
          timestamp: "2026-04-17T12:00:00Z",
          agentId: "bot-1",
          agentName: "bot-1",
          toolName: "exec",
          description: "",
          riskScore: 50,
          riskTier: "medium" as const,
          timeoutMs: 60_000,
        },
      ],
      blocked: [
        {
          kind: "blocked" as const,
          toolCallId: "tc2",
          timestamp: "2026-04-17T11:55:00Z",
          agentId: "bot-1",
          agentName: "bot-1",
          toolName: "rm",
          description: "",
          riskScore: 80,
          riskTier: "high" as const,
        },
      ],
      agentAttention: [],
      highRisk: [],
      allowNotify: [],
      generatedAt: "2026-04-17T12:10:00Z",
    };
    const { agents, reasons } = deriveAttentionFlags(att);
    expect(agents.has("bot-1")).toBe(true);
    expect(reasons.get("bot-1")).toBe("Pending approval: exec");
  });

  it("picks highRisk reason when only highRisk fires", () => {
    const att = {
      pending: [],
      blocked: [],
      agentAttention: [],
      highRisk: [
        {
          kind: "high_risk" as const,
          toolCallId: "tc1",
          timestamp: "2026-04-17T12:00:00Z",
          agentId: "bot-1",
          agentName: "bot-1",
          toolName: "exec",
          description: "",
          riskScore: 80,
          riskTier: "high" as const,
        },
      ],
      allowNotify: [],
      generatedAt: "2026-04-17T12:10:00Z",
    };
    const { agents, reasons } = deriveAttentionFlags(att);
    expect(agents.has("bot-1")).toBe(true);
    expect(reasons.get("bot-1")).toBe("High risk activity detected");
  });
});

describe("SessionInfo — new fields", () => {
  it("includes activityBreakdown", () => {
    const entries = [
      entry({
        sessionKey: "s1",
        agentId: "bot-1",
        decision: "allow",
        toolName: "read",
        timestamp: "2026-03-29T10:00:00Z",
      }),
      entry({
        sessionKey: "s1",
        agentId: "bot-1",
        decision: "allow",
        toolName: "exec",
        timestamp: "2026-03-29T10:01:00Z",
      }),
    ];
    const result = getSessions(entries);
    const session = result.sessions[0];
    expect(session.activityBreakdown).toBeDefined();
    expect(session.activityBreakdown.exploring).toBe(50);
    expect(session.activityBreakdown.scripts).toBe(50);
  });

  it("includes blockedCount", () => {
    const entries = [
      entry({
        sessionKey: "s1",
        agentId: "bot-1",
        decision: "allow",
        timestamp: "2026-03-29T10:00:00Z",
      }),
      entry({
        sessionKey: "s1",
        agentId: "bot-1",
        decision: "block",
        timestamp: "2026-03-29T10:01:00Z",
      }),
      entry({
        sessionKey: "s1",
        agentId: "bot-1",
        decision: "allow",
        userResponse: "denied",
        timestamp: "2026-03-29T10:02:00Z",
      }),
    ];
    const result = getSessions(entries);
    expect(result.sessions[0].blockedCount).toBe(2);
  });

  it("includes context from session key", () => {
    const entries = [
      entry({
        sessionKey: "agent:social:cron:mention-monitor-007",
        agentId: "social",
        decision: "allow",
        timestamp: "2026-03-29T10:00:00Z",
      }),
    ];
    const result = getSessions(entries);
    expect(result.sessions[0].context).toBe("Cron: Mention monitor");
  });
});

describe("EntryResponse — category field", () => {
  it("includes category on entries", () => {
    const entries = [
      entry({
        decision: "allow",
        toolName: "read",
        timestamp: "2026-03-29T10:00:00Z",
      }),
      entry({
        decision: "allow",
        toolName: "exec",
        timestamp: "2026-03-29T10:01:00Z",
      }),
    ];
    const result = getRecentEntries(entries, 10, 0);
    // exec without params.command → scripts fallback (newest first).
    expect(result[0].category).toBe("scripts");
    expect(result[1].category).toBe("exploring"); // read
  });

  it("includes category on session detail entries", () => {
    const entries = [
      entry({
        sessionKey: "s1",
        agentId: "bot-1",
        decision: "allow",
        toolName: "write",
        timestamp: "2026-03-29T10:00:00Z",
      }),
    ];
    const result = getSessionDetail(entries, "s1");
    expect(result!.entries[0].category).toBe("changes");
  });
});

describe("getRecentEntries — filtering", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-29T14:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const testEntries = () => [
    entry({
      agentId: "bot-1",
      decision: "allow",
      toolName: "read",
      riskTier: "low",
      riskScore: 10,
      timestamp: "2026-03-29T10:00:00Z",
    }),
    entry({
      agentId: "bot-1",
      decision: "block",
      toolName: "exec",
      riskTier: "high",
      riskScore: 70,
      timestamp: "2026-03-29T12:00:00Z",
    }),
    entry({
      agentId: "bot-2",
      decision: "allow",
      toolName: "write",
      riskTier: "medium",
      riskScore: 35,
      timestamp: "2026-03-29T13:00:00Z",
    }),
    entry({
      agentId: "bot-2",
      decision: "allow",
      toolName: "web_search",
      riskTier: "low",
      riskScore: 5,
      timestamp: "2026-03-29T13:30:00Z",
    }),
  ];

  it("filters by agent", () => {
    const result = getRecentEntries(testEntries(), 50, 0, { agent: "bot-1" });
    expect(result).toHaveLength(2);
    for (const e of result) expect(e.agentId).toBe("bot-1");
  });

  it("filters by category", () => {
    const result = getRecentEntries(testEntries(), 50, 0, {
      category: "exploring",
    });
    expect(result).toHaveLength(1);
    expect(result[0].toolName).toBe("read");
  });

  it("filters by riskTier", () => {
    const result = getRecentEntries(testEntries(), 50, 0, {
      riskTier: "high",
    });
    expect(result).toHaveLength(1);
    expect(result[0].toolName).toBe("exec");
  });

  it("filters by decision", () => {
    const result = getRecentEntries(testEntries(), 50, 0, {
      decision: "block",
    });
    expect(result).toHaveLength(1);
    expect(result[0].toolName).toBe("exec");
  });

  it("filters by time window", () => {
    const result = getRecentEntries(testEntries(), 50, 0, { since: "6h" });
    // Only entries within last 6h of 14:00 = since 08:00
    expect(result.length).toBeGreaterThanOrEqual(3);
  });

  it("combines multiple filters", () => {
    const result = getRecentEntries(testEntries(), 50, 0, {
      agent: "bot-2",
      category: "web",
    });
    expect(result).toHaveLength(1);
    expect(result[0].toolName).toBe("web_search");
  });

  it("returns all when no filters", () => {
    const result = getRecentEntries(testEntries(), 50, 0);
    expect(result).toHaveLength(4);
  });

  it("returns all when since=all", () => {
    const result = getRecentEntries(testEntries(), 50, 0, { since: "all" });
    expect(result).toHaveLength(4);
  });
});

// ── Phase 1.2 tests ──────────────────────────────────

describe("getAgentDetail — currentSessionActivity", () => {
  it("returns only current session entries in currentSessionActivity", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-29T14:00:00Z"));

    const entries = [
      entry({
        agentId: "bot-1",
        sessionKey: "s-old",
        decision: "allow",
        toolName: "read",
        timestamp: "2026-03-29T02:00:00Z",
      }),
      entry({
        agentId: "bot-1",
        sessionKey: "s-current",
        decision: "allow",
        toolName: "exec",
        timestamp: "2026-03-29T13:57:00Z",
      }),
      entry({
        agentId: "bot-1",
        sessionKey: "s-current",
        decision: "allow",
        toolName: "read",
        timestamp: "2026-03-29T13:58:00Z",
      }),
    ];
    const result = getAgentDetail(entries, "bot-1");
    expect(result).not.toBeNull();
    // currentSessionActivity should only have entries from s-current
    expect(result!.currentSessionActivity).toHaveLength(2);
    result!.currentSessionActivity.forEach((e) => {
      expect(e.sessionKey).toBe("s-current");
    });
    // recentActivity should have all
    expect(result!.recentActivity).toHaveLength(3);

    vi.useRealTimers();
  });

  it("returns empty currentSessionActivity when agent is idle", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-29T14:00:00Z"));

    const entries = [
      entry({
        agentId: "bot-1",
        sessionKey: "s1",
        decision: "allow",
        toolName: "read",
        timestamp: "2026-03-29T10:00:00Z",
      }),
    ];
    const result = getAgentDetail(entries, "bot-1");
    expect(result).not.toBeNull();
    // Agent is idle (last activity >5 min ago), no currentSession
    expect(result!.agent.currentSession).toBeUndefined();
    expect(result!.currentSessionActivity).toHaveLength(0);

    vi.useRealTimers();
  });

  it("currentSessionActivity is in reverse chronological order", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-29T14:00:00Z"));

    const entries = [
      entry({
        agentId: "bot-1",
        sessionKey: "s1",
        decision: "allow",
        toolName: "read",
        timestamp: "2026-03-29T13:56:00Z",
      }),
      entry({
        agentId: "bot-1",
        sessionKey: "s1",
        decision: "allow",
        toolName: "exec",
        timestamp: "2026-03-29T13:58:00Z",
      }),
    ];
    const result = getAgentDetail(entries, "bot-1");
    expect(result!.currentSessionActivity[0].toolName).toBe("exec"); // newest first
    expect(result!.currentSessionActivity[1].toolName).toBe("read");

    vi.useRealTimers();
  });
});

describe("AgentInfo — todayActivityBreakdown", () => {
  it("computes todayActivityBreakdown from full day entries", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-29T14:00:00Z"));

    const entries = [
      // Old session with reads
      entry({
        agentId: "bot-1",
        sessionKey: "s-old",
        toolName: "read",
        decision: "allow",
        timestamp: "2026-03-29T08:00:00Z",
      }),
      entry({
        agentId: "bot-1",
        sessionKey: "s-old",
        toolName: "read",
        decision: "allow",
        timestamp: "2026-03-29T08:01:00Z",
      }),
      // Current session with exec
      entry({
        agentId: "bot-1",
        sessionKey: "s-current",
        toolName: "exec",
        decision: "allow",
        timestamp: "2026-03-29T13:58:00Z",
      }),
    ];

    const agents = getAgents(entries);
    const bot = agents.find((a) => a.id === "bot-1")!;

    // activityBreakdown is from current session only (exec = 100%).
    // Bare exec (no params.command) buckets into `scripts` under the new
    // taxonomy — the generic fallback for exec-without-sub-category.
    expect(bot.activityBreakdown.scripts).toBe(100);

    // todayActivityBreakdown reflects the full day
    expect(bot.todayActivityBreakdown.exploring).toBe(67);
    expect(bot.todayActivityBreakdown.scripts).toBe(33);

    vi.useRealTimers();
  });
});

describe("SessionInfo — toolSummary", () => {
  it("returns top 5 tools sorted by count", () => {
    const entries = [
      ...Array.from({ length: 7 }, (_, i) =>
        entry({
          sessionKey: "s1",
          agentId: "bot-1",
          decision: "allow",
          toolName: "exec",
          timestamp: `2026-03-29T10:${String(i).padStart(2, "0")}:00Z`,
        }),
      ),
      ...Array.from({ length: 3 }, (_, i) =>
        entry({
          sessionKey: "s1",
          agentId: "bot-1",
          decision: "allow",
          toolName: "read",
          timestamp: `2026-03-29T10:${String(10 + i).padStart(2, "0")}:00Z`,
        }),
      ),
      entry({
        sessionKey: "s1",
        agentId: "bot-1",
        decision: "allow",
        toolName: "write",
        timestamp: "2026-03-29T10:20:00Z",
      }),
    ];

    const result = getSessions(entries);
    const session = result.sessions[0];
    expect(session.toolSummary).toBeDefined();
    expect(session.toolSummary.length).toBeLessThanOrEqual(5);
    // exec should be first (highest count)
    expect(session.toolSummary[0].toolName).toBe("exec");
    expect(session.toolSummary[0].count).toBe(7);
    // Tool summary uses the generic tool-level category (no sub-category
    // context per individual call), so bare `exec` falls into `scripts`.
    expect(session.toolSummary[0].category).toBe("scripts");
    // read second
    expect(session.toolSummary[1].toolName).toBe("read");
    expect(session.toolSummary[1].count).toBe(3);
  });
});

describe("SessionInfo — riskSparkline", () => {
  it("returns chronological risk scores", () => {
    const entries = [
      entry({
        sessionKey: "s1",
        decision: "allow",
        riskScore: 10,
        timestamp: "2026-03-29T10:00:00Z",
      }),
      entry({
        sessionKey: "s1",
        decision: "allow",
        riskScore: 50,
        timestamp: "2026-03-29T10:01:00Z",
      }),
      entry({
        sessionKey: "s1",
        decision: "allow",
        riskScore: 20,
        timestamp: "2026-03-29T10:02:00Z",
      }),
    ];

    const result = getSessions(entries);
    const session = result.sessions[0];
    expect(session.riskSparkline).toEqual([10, 50, 20]);
  });

  it("samples to max 20 points for long sessions", () => {
    const entries = Array.from({ length: 50 }, (_, i) =>
      entry({
        sessionKey: "s1",
        decision: "allow",
        riskScore: i * 2,
        timestamp: `2026-03-29T10:${String(i).padStart(2, "0")}:00Z`,
      }),
    );

    const result = getSessions(entries);
    const session = result.sessions[0];
    expect(session.riskSparkline).toHaveLength(20);
    // First point should be 0 (first entry)
    expect(session.riskSparkline[0]).toBe(0);
    // Last point should be 98 (last entry)
    expect(session.riskSparkline[19]).toBe(98);
  });

  it("returns empty array when no risk scores", () => {
    const entries = [
      entry({
        sessionKey: "s1",
        decision: "allow",
        timestamp: "2026-03-29T10:00:00Z",
      }),
    ];

    const result = getSessions(entries);
    expect(result.sessions[0].riskSparkline).toEqual([]);
  });
});

describe("groupBySessions — cron run splitting", () => {
  it("splits recurring cron sessions with >30 min gaps", () => {
    const entries = [
      // Run 1: 10:00–10:02
      entry({
        sessionKey: "agent:bot:cron:job-001",
        decision: "allow",
        timestamp: "2026-03-29T10:00:00Z",
      }),
      entry({
        sessionKey: "agent:bot:cron:job-001",
        decision: "allow",
        timestamp: "2026-03-29T10:02:00Z",
      }),
      // Run 2: 11:00–11:01 (58 min gap)
      entry({
        sessionKey: "agent:bot:cron:job-001",
        decision: "allow",
        timestamp: "2026-03-29T11:00:00Z",
      }),
      entry({
        sessionKey: "agent:bot:cron:job-001",
        decision: "allow",
        timestamp: "2026-03-29T11:01:00Z",
      }),
    ];
    const result = getSessions(entries);
    expect(result.total).toBe(2);
    expect(result.sessions[0].toolCallCount).toBe(2);
    expect(result.sessions[1].toolCallCount).toBe(2);
  });

  it("keeps sessions together when gaps are < 30 min", () => {
    const entries = [
      entry({ sessionKey: "s1", decision: "allow", timestamp: "2026-03-29T10:00:00Z" }),
      entry({ sessionKey: "s1", decision: "allow", timestamp: "2026-03-29T10:15:00Z" }),
      entry({ sessionKey: "s1", decision: "allow", timestamp: "2026-03-29T10:29:00Z" }),
    ];
    const result = getSessions(entries);
    expect(result.total).toBe(1);
    expect(result.sessions[0].toolCallCount).toBe(3);
  });

  it("sorts sessions by most recent activity, not start time", () => {
    const entries = [
      // Old session with recent run
      entry({
        sessionKey: "agent:bot:cron:job-001",
        decision: "allow",
        timestamp: "2026-03-29T08:00:00Z",
      }),
      entry({
        sessionKey: "agent:bot:cron:job-001",
        decision: "allow",
        timestamp: "2026-03-29T13:00:00Z",
      }),
      // Newer session, but no recent activity
      entry({ sessionKey: "s2", decision: "allow", timestamp: "2026-03-29T09:00:00Z" }),
    ];
    const result = getSessions(entries);
    expect(result.total).toBe(3); // job-001 splits into 2 + s2
    // Most recent activity (13:00) should be first
    expect(result.sessions[0].startTime).toBe("2026-03-29T13:00:00Z");
  });

  it("getSessionDetail resolves split session keys", () => {
    const entries = [
      entry({
        sessionKey: "agent:bot:cron:job-001",
        agentId: "bot",
        decision: "allow",
        toolName: "read",
        timestamp: "2026-03-29T10:00:00Z",
      }),
      entry({
        sessionKey: "agent:bot:cron:job-001",
        agentId: "bot",
        decision: "allow",
        toolName: "exec",
        timestamp: "2026-03-29T12:00:00Z",
      }),
    ];
    // These are 2h apart (>30 min gap) so they split into job-001 and job-001#2
    const detail = getSessionDetail(entries, "agent:bot:cron:job-001#2");
    expect(detail).not.toBeNull();
    expect(detail!.entries).toHaveLength(1);
    expect(detail!.entries[0].toolName).toBe("exec");
  });

  it("preserves original key for first run, appends #N for subsequent", () => {
    const entries = [
      entry({
        sessionKey: "agent:bot:cron:job-001",
        decision: "allow",
        timestamp: "2026-03-29T10:00:00Z",
      }),
      entry({
        sessionKey: "agent:bot:cron:job-001",
        decision: "allow",
        timestamp: "2026-03-29T12:00:00Z",
      }),
      entry({
        sessionKey: "agent:bot:cron:job-001",
        decision: "allow",
        timestamp: "2026-03-29T14:00:00Z",
      }),
    ];
    const result = getSessions(entries);
    expect(result.total).toBe(3);
    const keys = result.sessions.map((s) => s.sessionKey);
    expect(keys).toContain("agent:bot:cron:job-001");
    expect(keys).toContain("agent:bot:cron:job-001#2");
    expect(keys).toContain("agent:bot:cron:job-001#3");
  });
});

describe("getAgents todayCutoff — local calendar day", () => {
  it("counts only entries from the current local calendar day", () => {
    vi.useFakeTimers();
    // Set system time to 2026-03-29 14:00 local
    vi.setSystemTime(new Date(2026, 2, 29, 14, 0, 0));

    const yesterday = new Date(2026, 2, 28, 15, 0, 0); // yesterday 3pm local
    const todayMorning = new Date(2026, 2, 29, 8, 0, 0); // today 8am local
    const todayNoon = new Date(2026, 2, 29, 12, 0, 0); // today noon local

    const entries = [
      entry({ agentId: "bot-1", decision: "allow", timestamp: yesterday.toISOString() }),
      entry({ agentId: "bot-1", decision: "allow", timestamp: todayMorning.toISOString() }),
      entry({ agentId: "bot-1", decision: "allow", timestamp: todayNoon.toISOString() }),
    ];

    const agents = getAgents(entries);
    const bot = agents[0];
    // Only entries from today's local calendar day should count
    expect(bot.todayToolCalls).toBe(2);

    vi.useRealTimers();
  });
});

// ── LLM-adjusted score propagation ──────────────────────

describe("LLM score propagation", () => {
  /** Helper: build a decision entry + its corresponding LLM eval entry. */
  function entryWithEval(opts: {
    toolCallId: string;
    riskScore: number;
    adjustedScore: number;
    sessionKey?: string;
    agentId?: string;
    timestamp?: string;
    reasoning?: string;
  }) {
    const ts = opts.timestamp ?? "2026-03-29T10:00:00Z";
    const main = entry({
      toolCallId: opts.toolCallId,
      decision: "allow",
      riskScore: opts.riskScore,
      riskTier:
        opts.riskScore > 75
          ? "critical"
          : opts.riskScore > 50
            ? "high"
            : opts.riskScore > 25
              ? "medium"
              : "low",
      sessionKey: opts.sessionKey ?? "s1",
      agentId: opts.agentId ?? "bot-1",
      timestamp: ts,
    });
    const evalEntry = entry({
      refToolCallId: opts.toolCallId,
      toolName: main.toolName,
      llmEvaluation: {
        adjustedScore: opts.adjustedScore,
        reasoning: opts.reasoning ?? "Test evaluation",
        tags: [],
        confidence: "high",
        patterns: [],
      },
      riskScore: opts.adjustedScore,
      riskTier:
        opts.adjustedScore > 75
          ? "critical"
          : opts.adjustedScore > 50
            ? "high"
            : opts.adjustedScore > 25
              ? "medium"
              : "low",
      timestamp: ts,
    });
    return { main, evalEntry };
  }

  describe("EntryResponse — originalRiskScore", () => {
    it("sets originalRiskScore when LLM eval adjusts score", () => {
      const { main, evalEntry } = entryWithEval({
        toolCallId: "tc1",
        riskScore: 55,
        adjustedScore: 20,
        sessionKey: "s1",
      });
      const result = getSessionDetail([main, evalEntry], "s1");
      expect(result).not.toBeNull();
      const e = result!.entries[0];
      expect(e.riskScore).toBe(20); // LLM-adjusted
      expect(e.originalRiskScore).toBe(55); // original tier 1
    });

    it("originalRiskScore is undefined when no LLM eval", () => {
      const entries = [
        entry({
          toolCallId: "tc1",
          decision: "allow",
          riskScore: 45,
          sessionKey: "s1",
          agentId: "bot-1",
          timestamp: "2026-03-29T10:00:00Z",
        }),
      ];
      const result = getSessionDetail(entries, "s1");
      expect(result!.entries[0].riskScore).toBe(45);
      expect(result!.entries[0].originalRiskScore).toBeUndefined();
    });

    it("includes llmEvaluation data on the entry", () => {
      const { main, evalEntry } = entryWithEval({
        toolCallId: "tc1",
        riskScore: 55,
        adjustedScore: 20,
        reasoning: "Health check, no risk",
      });
      const result = getSessionDetail([main, evalEntry], "s1");
      const e = result!.entries[0];
      expect(e.llmEvaluation).toBeDefined();
      expect(e.llmEvaluation!.adjustedScore).toBe(20);
      expect(e.llmEvaluation!.reasoning).toBe("Health check, no risk");
    });
  });

  describe("SessionInfo — uses LLM-adjusted scores", () => {
    it("peakRisk reflects LLM-adjusted scores, not tier 1", () => {
      const { main: m1, evalEntry: e1 } = entryWithEval({
        toolCallId: "tc1",
        riskScore: 55,
        adjustedScore: 20,
        timestamp: "2026-03-29T10:00:00Z",
      });
      const plain = entry({
        toolCallId: "tc2",
        decision: "allow",
        riskScore: 45,
        sessionKey: "s1",
        agentId: "bot-1",
        timestamp: "2026-03-29T10:01:00Z",
      });

      const result = getSessionDetail([m1, e1, plain], "s1");
      // Without LLM fix, peakRisk would be 55 (tier 1). With fix, it's 45.
      expect(result!.session.peakRisk).toBe(45);
    });

    it("avgRisk reflects LLM-adjusted scores", () => {
      const { main: m1, evalEntry: e1 } = entryWithEval({
        toolCallId: "tc1",
        riskScore: 60,
        adjustedScore: 10,
        timestamp: "2026-03-29T10:00:00Z",
      });
      const plain = entry({
        toolCallId: "tc2",
        decision: "allow",
        riskScore: 30,
        sessionKey: "s1",
        agentId: "bot-1",
        timestamp: "2026-03-29T10:01:00Z",
      });

      const result = getSessionDetail([m1, e1, plain], "s1");
      // avg should be (10 + 30) / 2 = 20, not (60 + 30) / 2 = 45
      expect(result!.session.avgRisk).toBe(20);
    });

    it("riskSparkline uses LLM-adjusted scores", () => {
      const { main: m1, evalEntry: e1 } = entryWithEval({
        toolCallId: "tc1",
        riskScore: 55,
        adjustedScore: 20,
        timestamp: "2026-03-29T10:00:00Z",
      });
      const { main: m2, evalEntry: e2 } = entryWithEval({
        toolCallId: "tc2",
        riskScore: 55,
        adjustedScore: 30,
        timestamp: "2026-03-29T10:01:00Z",
      });
      const plain = entry({
        toolCallId: "tc3",
        decision: "allow",
        riskScore: 5,
        sessionKey: "s1",
        agentId: "bot-1",
        timestamp: "2026-03-29T10:02:00Z",
      });

      const result = getSessionDetail([m1, e1, m2, e2, plain], "s1");
      // Sparkline should be [20, 30, 5] not [55, 55, 5]
      expect(result!.session.riskSparkline).toEqual([20, 30, 5]);
    });
  });

  describe("AgentInfo — uses LLM-adjusted scores", () => {
    it("agent peakRiskScore uses LLM-adjusted scores", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-03-29T14:00:00Z"));

      const { main: m1, evalEntry: e1 } = entryWithEval({
        toolCallId: "tc1",
        riskScore: 80,
        adjustedScore: 25,
        agentId: "bot-1",
        timestamp: "2026-03-29T10:00:00Z",
      });
      const plain = entry({
        toolCallId: "tc2",
        decision: "allow",
        riskScore: 40,
        agentId: "bot-1",
        sessionKey: "s1",
        timestamp: "2026-03-29T10:01:00Z",
      });

      const agents = getAgents([m1, e1, plain]);
      const bot = agents.find((a) => a.id === "bot-1")!;
      // Peak should be 40 (plain entry), not 80 (tier 1 of m1)
      expect(bot.peakRiskScore).toBe(40);

      vi.useRealTimers();
    });

    it("agent avgRiskScore uses LLM-adjusted scores", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-03-29T14:00:00Z"));

      const { main: m1, evalEntry: e1 } = entryWithEval({
        toolCallId: "tc1",
        riskScore: 60,
        adjustedScore: 10,
        agentId: "bot-1",
        timestamp: "2026-03-29T10:00:00Z",
      });
      const plain = entry({
        toolCallId: "tc2",
        decision: "allow",
        riskScore: 30,
        agentId: "bot-1",
        sessionKey: "s1",
        timestamp: "2026-03-29T10:01:00Z",
      });

      const agents = getAgents([m1, e1, plain]);
      const bot = agents.find((a) => a.id === "bot-1")!;
      // avg should be (10 + 30) / 2 = 20, not (60 + 30) / 2 = 45
      expect(bot.avgRiskScore).toBe(20);

      vi.useRealTimers();
    });

    it("needsAttention uses LLM-adjusted peak, not tier 1", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-03-29T14:00:00Z"));

      // Tier 1 score is 80 (>= 75 threshold), but LLM adjusts to 25
      const { main: m1, evalEntry: e1 } = entryWithEval({
        toolCallId: "tc1",
        riskScore: 80,
        adjustedScore: 25,
        agentId: "bot-1",
        timestamp: "2026-03-29T10:00:00Z",
      });

      const agents = getAgents([m1, e1]);
      const bot = agents.find((a) => a.id === "bot-1")!;
      // With LLM adjustment, peak is 25 (< 75), so no attention needed
      expect(bot.needsAttention).toBe(false);

      vi.useRealTimers();
    });
  });
});
