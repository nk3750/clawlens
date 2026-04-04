import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  computeEnhancedStats,
  getAgents,
  getAgentDetail,
  getSessions,
  getSessionDetail,
} from "../src/dashboard/api";
import type { AuditEntry } from "../src/audit/logger";

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

  it("includes base stats fields", () => {
    const entries = [
      entry({ timestamp: "2026-03-29T10:00:00Z", decision: "allow" }),
    ];
    const stats = computeEnhancedStats(entries);
    expect(stats.allowed).toBe(1);
    expect(stats.total).toBe(1);
    expect(stats.riskBreakdown).toBeDefined();
    expect(stats.avgRiskScore).toBeDefined();
    expect(stats.peakRiskScore).toBeDefined();
    expect(stats.activeAgents).toBeDefined();
    expect(stats.activeSessions).toBeDefined();
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
    const entries = [
      entry({ timestamp: "2026-03-29T10:00:00Z", decision: "allow" }),
    ];
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
    expect(result!.sessions).toHaveLength(1);
    expect(result!.totalSessions).toBe(1);
  });

  it("returns recent activity in reverse chronological order", () => {
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
  });

  it("limits recent activity to 20 entries", () => {
    const entries = Array.from({ length: 30 }, (_, i) =>
      entry({
        agentId: "bot-1",
        decision: "allow",
        timestamp: `2026-03-29T10:${String(i).padStart(2, "0")}:00Z`,
      }),
    );
    const result = getAgentDetail(entries, "bot-1");
    expect(result!.recentActivity).toHaveLength(20);
  });

  it("excludes other agents' entries", () => {
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
  });
});
