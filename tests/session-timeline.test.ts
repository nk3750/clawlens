import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditEntry } from "../src/audit/logger";
import { buildSessionSegments, getSessionTimeline } from "../src/dashboard/api";

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

// ── buildSessionSegments ─────────────────────────────────

describe("buildSessionSegments", () => {
  it("returns a single segment when all entries have the same category", () => {
    const entries = [
      entry({ toolName: "read", timestamp: "2026-04-12T09:00:00Z", decision: "allow" }),
      entry({ toolName: "grep", timestamp: "2026-04-12T09:05:00Z", decision: "allow" }),
      entry({ toolName: "glob", timestamp: "2026-04-12T09:10:00Z", decision: "allow" }),
    ];
    const segments = buildSessionSegments(entries);
    expect(segments).toHaveLength(1);
    expect(segments[0].category).toBe("exploring");
    expect(segments[0].startTime).toBe("2026-04-12T09:00:00Z");
    expect(segments[0].endTime).toBe("2026-04-12T09:10:00Z");
  });

  it("creates separate segments for different categories", () => {
    const entries = [
      entry({ toolName: "read", timestamp: "2026-04-12T09:00:00Z", decision: "allow" }),
      entry({ toolName: "exec", timestamp: "2026-04-12T09:05:00Z", decision: "allow" }),
      entry({ toolName: "write", timestamp: "2026-04-12T09:10:00Z", decision: "allow" }),
    ];
    const segments = buildSessionSegments(entries);
    expect(segments).toHaveLength(3);
    expect(segments[0].category).toBe("exploring");
    expect(segments[1].category).toBe("commands");
    expect(segments[2].category).toBe("changes");
  });

  it("merges consecutive entries of the same category", () => {
    const entries = [
      entry({ toolName: "read", timestamp: "2026-04-12T09:00:00Z", decision: "allow" }),
      entry({ toolName: "grep", timestamp: "2026-04-12T09:02:00Z", decision: "allow" }),
      entry({ toolName: "exec", timestamp: "2026-04-12T09:05:00Z", decision: "allow" }),
      entry({ toolName: "read", timestamp: "2026-04-12T09:10:00Z", decision: "allow" }),
      entry({ toolName: "search", timestamp: "2026-04-12T09:12:00Z", decision: "allow" }),
    ];
    const segments = buildSessionSegments(entries);
    // exploring(read,grep) → commands(exec) → exploring(read,search)
    expect(segments).toHaveLength(3);
    expect(segments[0].category).toBe("exploring");
    expect(segments[0].endTime).toBe("2026-04-12T09:02:00Z");
    expect(segments[1].category).toBe("commands");
    expect(segments[2].category).toBe("exploring");
    expect(segments[2].startTime).toBe("2026-04-12T09:10:00Z");
  });

  it("returns a single segment with startTime === endTime for one entry", () => {
    const entries = [
      entry({ toolName: "exec", timestamp: "2026-04-12T09:00:00Z", decision: "allow" }),
    ];
    const segments = buildSessionSegments(entries);
    expect(segments).toHaveLength(1);
    expect(segments[0].startTime).toBe(segments[0].endTime);
  });

  it("filters out non-decision entries", () => {
    const entries = [
      entry({ toolName: "exec", timestamp: "2026-04-12T09:00:00Z", decision: "allow" }),
      entry({ toolName: "read", timestamp: "2026-04-12T09:01:00Z", executionResult: "success" }),
      entry({ toolName: "write", timestamp: "2026-04-12T09:02:00Z", decision: "allow" }),
    ];
    const segments = buildSessionSegments(entries);
    // Only 2 decision entries: exec(commands) → write(changes)
    expect(segments).toHaveLength(2);
    expect(segments[0].category).toBe("commands");
    expect(segments[1].category).toBe("changes");
  });

  it("returns empty array for entries with no decisions", () => {
    const entries = [
      entry({ toolName: "exec", timestamp: "2026-04-12T09:00:00Z", executionResult: "success" }),
    ];
    expect(buildSessionSegments(entries)).toEqual([]);
  });

  it("returns actionCount: 1 for a single-entry segment", () => {
    const entries = [
      entry({ toolName: "exec", timestamp: "2026-04-12T09:00:00Z", decision: "allow" }),
    ];
    const segments = buildSessionSegments(entries);
    expect(segments).toHaveLength(1);
    expect(segments[0].actionCount).toBe(1);
  });

  it("returns cumulative actionCount for merged same-category entries", () => {
    const entries = [
      entry({ toolName: "read", timestamp: "2026-04-12T09:00:00Z", decision: "allow" }),
      entry({ toolName: "grep", timestamp: "2026-04-12T09:05:00Z", decision: "allow" }),
      entry({ toolName: "glob", timestamp: "2026-04-12T09:10:00Z", decision: "allow" }),
    ];
    const segments = buildSessionSegments(entries);
    expect(segments).toHaveLength(1);
    expect(segments[0].actionCount).toBe(3);
  });

  it("tracks actionCount per segment across category transitions", () => {
    const entries = [
      entry({ toolName: "read", timestamp: "2026-04-12T09:00:00Z", decision: "allow" }),
      entry({ toolName: "grep", timestamp: "2026-04-12T09:02:00Z", decision: "allow" }),
      entry({ toolName: "exec", timestamp: "2026-04-12T09:05:00Z", decision: "allow" }),
      entry({ toolName: "read", timestamp: "2026-04-12T09:10:00Z", decision: "allow" }),
      entry({ toolName: "search", timestamp: "2026-04-12T09:12:00Z", decision: "allow" }),
    ];
    const segments = buildSessionSegments(entries);
    expect(segments).toHaveLength(3);
    expect(segments[0].actionCount).toBe(2); // read + grep
    expect(segments[1].actionCount).toBe(1); // exec
    expect(segments[2].actionCount).toBe(2); // read + search
  });

  it("segment actionCounts sum to total entry count", () => {
    const entries = [
      entry({ toolName: "read", timestamp: "2026-04-12T09:00:00Z", decision: "allow" }),
      entry({ toolName: "exec", timestamp: "2026-04-12T09:01:00Z", decision: "allow" }),
      entry({ toolName: "exec", timestamp: "2026-04-12T09:02:00Z", decision: "allow" }),
      entry({ toolName: "write", timestamp: "2026-04-12T09:03:00Z", decision: "allow" }),
      entry({ toolName: "read", timestamp: "2026-04-12T09:04:00Z", decision: "allow" }),
    ];
    const segments = buildSessionSegments(entries);
    const totalActionCount = segments.reduce((sum, s) => sum + s.actionCount, 0);
    expect(totalActionCount).toBe(5);
  });
});

// ── getSessionTimeline ───────────────────────────────────

describe("getSessionTimeline", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 12, 14, 0, 0)); // April 12 2pm local
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns empty response for no entries", () => {
    const result = getSessionTimeline([]);
    expect(result.agents).toEqual([]);
    expect(result.sessions).toEqual([]);
    expect(result.totalActions).toBe(0);
  });

  it("groups entries into a single session", () => {
    const entries = [
      entry({
        sessionKey: "s1",
        agentId: "bot-1",
        toolName: "read",
        decision: "allow",
        timestamp: new Date(2026, 3, 12, 9, 0, 0).toISOString(),
      }),
      entry({
        sessionKey: "s1",
        agentId: "bot-1",
        toolName: "exec",
        decision: "allow",
        timestamp: new Date(2026, 3, 12, 9, 15, 0).toISOString(),
      }),
    ];

    const result = getSessionTimeline(entries);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].sessionKey).toBe("s1");
    expect(result.sessions[0].agentId).toBe("bot-1");
    expect(result.sessions[0].actionCount).toBe(2);
    expect(result.agents).toEqual(["bot-1"]);
    expect(result.totalActions).toBe(2);
  });

  it("splits sessions with gap > 30 minutes", () => {
    const entries = [
      entry({
        sessionKey: "s1",
        agentId: "bot-1",
        toolName: "read",
        decision: "allow",
        timestamp: new Date(2026, 3, 12, 9, 0, 0).toISOString(),
      }),
      entry({
        sessionKey: "s1",
        agentId: "bot-1",
        toolName: "exec",
        decision: "allow",
        timestamp: new Date(2026, 3, 12, 10, 0, 0).toISOString(), // 60 min gap
      }),
    ];

    const result = getSessionTimeline(entries);
    expect(result.sessions).toHaveLength(2);
    // First session keeps key "s1", second gets "s1#2"
    const keys = result.sessions.map((s) => s.sessionKey);
    expect(keys).toContain("s1");
    expect(keys).toContain("s1#2");
  });

  it("handles multiple agents sorted by action count", () => {
    const entries = [
      entry({
        sessionKey: "s1",
        agentId: "bot-a",
        toolName: "read",
        decision: "allow",
        timestamp: new Date(2026, 3, 12, 9, 0, 0).toISOString(),
      }),
      entry({
        sessionKey: "s2",
        agentId: "bot-b",
        toolName: "exec",
        decision: "allow",
        timestamp: new Date(2026, 3, 12, 9, 1, 0).toISOString(),
      }),
      entry({
        sessionKey: "s2",
        agentId: "bot-b",
        toolName: "read",
        decision: "allow",
        timestamp: new Date(2026, 3, 12, 9, 5, 0).toISOString(),
      }),
    ];

    const result = getSessionTimeline(entries);
    expect(result.agents).toEqual(["bot-b", "bot-a"]); // bot-b has 2, bot-a has 1
  });

  it("builds correct segments for a session", () => {
    const entries = [
      entry({
        sessionKey: "s1",
        agentId: "bot-1",
        toolName: "read",
        decision: "allow",
        timestamp: new Date(2026, 3, 12, 9, 0, 0).toISOString(),
      }),
      entry({
        sessionKey: "s1",
        agentId: "bot-1",
        toolName: "grep",
        decision: "allow",
        timestamp: new Date(2026, 3, 12, 9, 5, 0).toISOString(),
      }),
      entry({
        sessionKey: "s1",
        agentId: "bot-1",
        toolName: "exec",
        decision: "allow",
        timestamp: new Date(2026, 3, 12, 9, 10, 0).toISOString(),
      }),
    ];

    const result = getSessionTimeline(entries);
    const session = result.sessions[0];
    // read + grep = exploring, then exec = commands
    expect(session.segments).toHaveLength(2);
    expect(session.segments[0].category).toBe("exploring");
    expect(session.segments[1].category).toBe("commands");
  });

  it("detects active sessions", () => {
    // Entry within the last 5 minutes
    const recentTs = new Date(Date.now() - 2 * 60_000); // 2 min ago
    const entries = [
      entry({
        sessionKey: "s1",
        agentId: "bot-1",
        toolName: "read",
        decision: "allow",
        timestamp: recentTs.toISOString(),
      }),
    ];

    const result = getSessionTimeline(entries);
    expect(result.sessions[0].isActive).toBe(true);
  });

  it("marks inactive sessions", () => {
    const oldTs = new Date(2026, 3, 12, 9, 0, 0); // ~5h ago, not active
    const entries = [
      entry({
        sessionKey: "s1",
        agentId: "bot-1",
        toolName: "read",
        decision: "allow",
        timestamp: oldTs.toISOString(),
      }),
    ];

    const result = getSessionTimeline(entries);
    expect(result.sessions[0].isActive).toBe(false);
  });

  it("computes blocked count correctly", () => {
    const entries = [
      entry({
        sessionKey: "s1",
        agentId: "bot-1",
        toolName: "exec",
        decision: "block",
        timestamp: new Date(2026, 3, 12, 9, 0, 0).toISOString(),
      }),
      entry({
        sessionKey: "s1",
        agentId: "bot-1",
        toolName: "exec",
        decision: "allow",
        userResponse: "denied",
        timestamp: new Date(2026, 3, 12, 9, 1, 0).toISOString(),
      }),
      entry({
        sessionKey: "s1",
        agentId: "bot-1",
        toolName: "read",
        decision: "allow",
        timestamp: new Date(2026, 3, 12, 9, 2, 0).toISOString(),
      }),
    ];

    const result = getSessionTimeline(entries);
    expect(result.sessions[0].blockedCount).toBe(2); // block + denied
    expect(result.sessions[0].actionCount).toBe(3);
  });

  it("computes risk stats correctly", () => {
    const entries = [
      entry({
        sessionKey: "s1",
        agentId: "bot-1",
        toolName: "exec",
        decision: "allow",
        riskScore: 20,
        timestamp: new Date(2026, 3, 12, 9, 0, 0).toISOString(),
      }),
      entry({
        sessionKey: "s1",
        agentId: "bot-1",
        toolName: "exec",
        decision: "allow",
        riskScore: 60,
        timestamp: new Date(2026, 3, 12, 9, 5, 0).toISOString(),
      }),
    ];

    const result = getSessionTimeline(entries);
    expect(result.sessions[0].avgRisk).toBe(40);
    expect(result.sessions[0].peakRisk).toBe(60);
  });

  it("filters to specific date when provided", () => {
    const entries = [
      entry({
        sessionKey: "s1",
        agentId: "bot-1",
        toolName: "read",
        decision: "allow",
        timestamp: new Date(2026, 3, 11, 10, 0, 0).toISOString(), // April 11
      }),
      entry({
        sessionKey: "s2",
        agentId: "bot-1",
        toolName: "read",
        decision: "allow",
        timestamp: new Date(2026, 3, 12, 10, 0, 0).toISOString(), // April 12
      }),
    ];

    const result = getSessionTimeline(entries, "2026-04-11");
    expect(result.totalActions).toBe(1);
    expect(result.sessions).toHaveLength(1);
  });

  it("filters by range on past day", () => {
    const entries = [
      entry({
        sessionKey: "s1",
        agentId: "bot-1",
        toolName: "read",
        decision: "allow",
        timestamp: new Date(2026, 3, 11, 1, 0, 0).toISOString(), // 1am
      }),
      entry({
        sessionKey: "s2",
        agentId: "bot-1",
        toolName: "read",
        decision: "allow",
        timestamp: new Date(2026, 3, 11, 10, 0, 0).toISOString(), // 10am
      }),
    ];

    // 3h range = midnight to 3am local
    const result = getSessionTimeline(entries, "2026-04-11", "3h");
    expect(result.totalActions).toBe(1);
  });

  it("excludes sessions entirely outside the view window", () => {
    const entries = [
      entry({
        sessionKey: "s1",
        agentId: "bot-1",
        toolName: "read",
        decision: "allow",
        timestamp: new Date(2026, 3, 11, 0, 30, 0).toISOString(), // 12:30am
      }),
      entry({
        sessionKey: "s2",
        agentId: "bot-1",
        toolName: "read",
        decision: "allow",
        timestamp: new Date(2026, 3, 11, 10, 0, 0).toISOString(), // 10am — outside 3h range
      }),
    ];

    const result = getSessionTimeline(entries, "2026-04-11", "3h");
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].sessionKey).toBe("s1");
  });

  it("uses LLM-adjusted scores when available", () => {
    const entries = [
      entry({
        sessionKey: "s1",
        agentId: "bot-1",
        toolName: "exec",
        toolCallId: "tc-1",
        decision: "allow",
        riskScore: 30,
        timestamp: new Date(2026, 3, 12, 9, 0, 0).toISOString(),
      }),
      // LLM eval entry
      entry({
        toolName: "llm_eval",
        refToolCallId: "tc-1",
        llmEvaluation: { adjustedScore: 75, reasoning: "high risk", tier: "high", confidence: 0.9 },
        timestamp: new Date(2026, 3, 12, 9, 0, 1).toISOString(),
      }),
    ];

    const result = getSessionTimeline(entries);
    expect(result.sessions[0].peakRisk).toBe(75); // LLM-adjusted, not original 30
  });
});
