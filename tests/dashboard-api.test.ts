import * as crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditEntry } from "../src/audit/logger";
import {
  checkHealth,
  computeEnhancedStats,
  computeStats,
  getAgents,
  getEffectiveDecision,
  getRecentEntries,
  resolveSplitKeyForEntry,
} from "../src/dashboard/api";
import {
  computeBreakdown,
  describeAction,
  getCategory,
  parseSessionContext,
  riskPosture,
} from "../src/dashboard/categories";

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

describe("getEffectiveDecision", () => {
  it("maps userResponse over raw decision", () => {
    expect(
      getEffectiveDecision(entry({ decision: "approval_required", userResponse: "approved" })),
    ).toBe("approved");
    expect(
      getEffectiveDecision(entry({ decision: "approval_required", userResponse: "denied" })),
    ).toBe("denied");
    expect(
      getEffectiveDecision(entry({ decision: "approval_required", userResponse: "timeout" })),
    ).toBe("timeout");
  });

  it("maps raw decisions when no userResponse", () => {
    expect(getEffectiveDecision(entry({ decision: "allow" }))).toBe("allow");
    expect(getEffectiveDecision(entry({ decision: "block" }))).toBe("block");
    // In observe mode, approval_required without userResponse means
    // the action was allowed through — not actually pending
    expect(getEffectiveDecision(entry({ decision: "approval_required" }))).toBe("allow");
  });

  it("falls back to executionResult for result entries", () => {
    expect(getEffectiveDecision(entry({ executionResult: "success" }))).toBe("success");
    expect(getEffectiveDecision(entry({ executionResult: "failure" }))).toBe("failure");
  });

  it("returns unknown for entries with no decision info", () => {
    expect(getEffectiveDecision(entry())).toBe("unknown");
  });
});

describe("computeStats", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 29, 14, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns zeros for empty entries", () => {
    const stats = computeStats([]);
    expect(stats).toEqual({
      total: 0,
      allowed: 0,
      approved: 0,
      blocked: 0,
      timedOut: 0,
      pending: 0,
    });
  });

  it("counts allowed, blocked, approved, timedOut correctly", () => {
    const entries: AuditEntry[] = [
      entry({ timestamp: "2026-03-29T10:00:00Z", decision: "allow" }),
      entry({ timestamp: "2026-03-29T10:01:00Z", decision: "allow" }),
      entry({ timestamp: "2026-03-29T10:02:00Z", decision: "block" }),
      entry({ timestamp: "2026-03-29T10:03:00Z", decision: "allow", userResponse: "approved" }),
      entry({ timestamp: "2026-03-29T10:04:00Z", decision: "block", userResponse: "denied" }),
      entry({
        timestamp: "2026-03-29T10:05:00Z",
        decision: "approval_required",
        userResponse: "timeout",
      }),
      entry({ timestamp: "2026-03-29T10:06:00Z", decision: "approval_required" }),
    ];

    const stats = computeStats(entries);
    expect(stats.allowed).toBe(3); // 2 explicit allow + 1 approval_required (observe mode passthrough)
    expect(stats.approved).toBe(1);
    expect(stats.blocked).toBe(2); // 1 block + 1 denied
    expect(stats.timedOut).toBe(1);
    expect(stats.pending).toBe(0);
    expect(stats.total).toBe(7);
  });

  it("only counts entries from today's local calendar day", () => {
    const entries: AuditEntry[] = [
      entry({ timestamp: new Date(2026, 2, 28, 10, 0, 0).toISOString(), decision: "allow" }), // yesterday
      entry({ timestamp: new Date(2026, 2, 29, 8, 0, 0).toISOString(), decision: "allow" }), // today
      entry({ timestamp: new Date(2026, 2, 29, 13, 0, 0).toISOString(), decision: "block" }), // today
    ];

    const stats = computeStats(entries);
    expect(stats.total).toBe(2);
    expect(stats.allowed).toBe(1);
    expect(stats.blocked).toBe(1);
  });

  it("excludes result entries (no decision field)", () => {
    const entries: AuditEntry[] = [
      entry({ timestamp: "2026-03-29T10:00:00Z", decision: "allow" }),
      entry({ timestamp: "2026-03-29T10:01:00Z", executionResult: "success" }), // no decision
    ];

    const stats = computeStats(entries);
    expect(stats.total).toBe(1);
    expect(stats.allowed).toBe(1);
  });
});

describe("getRecentEntries", () => {
  const entries: AuditEntry[] = [
    entry({ timestamp: "2026-03-29T10:00:00Z", toolName: "read", decision: "allow" }),
    entry({ timestamp: "2026-03-29T10:01:00Z", toolName: "write", decision: "block" }),
    entry({ timestamp: "2026-03-29T10:02:00Z", toolName: "exec", decision: "allow" }),
    entry({
      timestamp: "2026-03-29T10:03:00Z",
      toolName: "message",
      decision: "approval_required",
      userResponse: "approved",
    }),
    // Result entry — should be excluded
    entry({ timestamp: "2026-03-29T10:04:00Z", toolName: "exec", executionResult: "success" }),
  ];

  it("returns entries in reverse chronological order", () => {
    const result = getRecentEntries(entries, 50, 0);
    expect(result).toHaveLength(4); // excludes result entry
    expect(result[0].toolName).toBe("message");
    expect(result[1].toolName).toBe("exec");
    expect(result[2].toolName).toBe("write");
    expect(result[3].toolName).toBe("read");
  });

  it("respects limit parameter", () => {
    const result = getRecentEntries(entries, 2, 0);
    expect(result).toHaveLength(2);
    expect(result[0].toolName).toBe("message");
    expect(result[1].toolName).toBe("exec");
  });

  it("respects offset parameter", () => {
    const result = getRecentEntries(entries, 2, 2);
    expect(result).toHaveLength(2);
    expect(result[0].toolName).toBe("write");
    expect(result[1].toolName).toBe("read");
  });

  it("includes effectiveDecision on each entry", () => {
    const result = getRecentEntries(entries, 50, 0);
    expect(result[0].effectiveDecision).toBe("approved");
    expect(result[1].effectiveDecision).toBe("allow");
    expect(result[2].effectiveDecision).toBe("block");
    expect(result[3].effectiveDecision).toBe("allow");
  });

  it("returns empty array for empty input", () => {
    expect(getRecentEntries([], 50, 0)).toEqual([]);
  });
});

describe("checkHealth", () => {
  it("returns valid:true and count for empty entries", () => {
    const result = checkHealth([]);
    expect(result).toEqual({ valid: true, totalEntries: 0 });
  });

  it("returns valid:true for intact chain", () => {
    function buildChain(count: number): AuditEntry[] {
      const chain: AuditEntry[] = [];
      let prevHash = "0";
      for (let i = 0; i < count; i++) {
        const base = {
          timestamp: `2026-03-29T10:0${i}:00Z`,
          toolName: "exec",
          params: {},
          decision: "allow" as const,
          prevHash,
        };
        const hash = crypto.createHash("sha256").update(JSON.stringify(base)).digest("hex");
        chain.push({ ...base, hash });
        prevHash = hash;
      }
      return chain;
    }

    const chain = buildChain(3);
    const result = checkHealth(chain);
    expect(result.valid).toBe(true);
    expect(result.totalEntries).toBe(3);
  });

  it("returns valid:false with brokenAt for tampered chain", () => {
    const e1base = {
      timestamp: "2026-03-29T10:00:00Z",
      toolName: "exec",
      params: {},
      decision: "allow" as const,
      prevHash: "0",
    };
    const e1hash = crypto.createHash("sha256").update(JSON.stringify(e1base)).digest("hex");
    const e1: AuditEntry = { ...e1base, hash: e1hash };

    const e2: AuditEntry = {
      timestamp: "2026-03-29T10:01:00Z",
      toolName: "exec",
      params: {},
      decision: "allow",
      prevHash: "wrong-hash", // broken link
      hash: "fake",
    };

    const result = checkHealth([e1, e2]);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(1);
    expect(result.totalEntries).toBe(2);
  });
});

// ── categories.ts tests ────────────────────────────

describe("getCategory", () => {
  it("maps known tools to their new domain buckets", () => {
    expect(getCategory("read")).toBe("exploring");
    expect(getCategory("search")).toBe("exploring");
    expect(getCategory("glob")).toBe("exploring");
    expect(getCategory("grep")).toBe("exploring");
    expect(getCategory("write")).toBe("changes");
    expect(getCategory("edit")).toBe("changes");
    // bare `exec` (no sub-category arg) falls through to the scripts fallback
    expect(getCategory("exec")).toBe("scripts");
    expect(getCategory("fetch_url")).toBe("web");
    expect(getCategory("message")).toBe("comms");
  });

  it("defaults unknown tools to scripts", () => {
    expect(getCategory("some_custom_tool")).toBe("scripts");
  });
});

describe("computeBreakdown", () => {
  it("returns correct percentages summing to 100", () => {
    const entries = [
      { toolName: "read" },
      { toolName: "read" },
      { toolName: "read" },
      { toolName: "write" },
      { toolName: "exec", execCategory: "scripting" },
    ];
    const breakdown = computeBreakdown(entries);
    expect(breakdown.exploring).toBe(60);
    expect(breakdown.changes).toBe(20);
    expect(breakdown.scripts).toBe(20);
    const sum = Object.values(breakdown).reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
  });

  it("handles empty entries", () => {
    const breakdown = computeBreakdown([]);
    const sum = Object.values(breakdown).reduce((a, b) => a + b, 0);
    expect(sum).toBe(0);
  });
});

describe("parseSessionContext", () => {
  it("parses cron sessions", () => {
    expect(parseSessionContext("agent:nightly-scan:cron:daily-audit")).toBe("Cron: Daily audit");
  });

  it("parses telegram sessions", () => {
    expect(parseSessionContext("agent:main:telegram:direct:123")).toBe("Telegram DM");
  });

  it("surfaces synthesized labels for unknown channel ids", () => {
    // 'web' is not a registered channel — the catalog title-cases the id.
    expect(parseSessionContext("agent:main:web:session:abc")).toBe("Web");
  });

  it("returns undefined for short keys", () => {
    expect(parseSessionContext("ab")).toBeUndefined();
  });
});

describe("describeAction", () => {
  it("describes read actions", () => {
    expect(describeAction({ toolName: "read", params: { path: "config.yaml" } })).toBe(
      "Read config.yaml",
    );
  });

  it("describes exec actions using parseExecCommand", () => {
    const desc = describeAction({ toolName: "exec", params: { command: "npm test" } });
    expect(desc).toContain("Ran");
    expect(desc).toContain("npm");
  });

  it("describes message actions", () => {
    const desc = describeAction({ toolName: "message", params: { to: "boss@co.com" } });
    expect(desc).toContain("boss@co.com");
  });
});

describe("riskPosture", () => {
  it("returns calm for low scores", () => {
    expect(riskPosture(0)).toBe("calm");
    expect(riskPosture(15)).toBe("calm");
    expect(riskPosture(20)).toBe("calm");
  });

  it("returns elevated for medium scores", () => {
    expect(riskPosture(21)).toBe("elevated");
    expect(riskPosture(35)).toBe("elevated");
    expect(riskPosture(45)).toBe("elevated");
  });

  it("returns high for high scores", () => {
    expect(riskPosture(46)).toBe("high");
    expect(riskPosture(60)).toBe("high");
    expect(riskPosture(70)).toBe("high");
  });

  it("returns critical for very high scores", () => {
    expect(riskPosture(71)).toBe("critical");
    expect(riskPosture(100)).toBe("critical");
  });
});

// ── Enhanced API tests ─────────────────────────────

describe("computeEnhancedStats", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 29, 14, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns riskPosture as valid string enum", () => {
    const entries: AuditEntry[] = [
      entry({
        timestamp: "2026-03-29T10:00:00Z",
        decision: "allow",
        riskScore: 15,
        riskTier: "low",
      }),
      entry({
        timestamp: "2026-03-29T10:01:00Z",
        decision: "allow",
        riskScore: 10,
        riskTier: "low",
      }),
    ];
    const stats = computeEnhancedStats(entries);
    expect(["calm", "elevated", "high", "critical"]).toContain(stats.riskPosture);
    expect(stats.riskPosture).toBe("calm");
  });

  it("overrides riskPosture to critical if recent block", () => {
    const entries: AuditEntry[] = [
      entry({
        timestamp: new Date(2026, 2, 29, 13, 45, 0).toISOString(),
        decision: "block",
        riskScore: 30,
        riskTier: "medium",
      }),
    ];
    const stats = computeEnhancedStats(entries);
    expect(stats.riskPosture).toBe("critical");
  });
});

describe("getRecentEntries — category field", () => {
  it("includes category on each entry; exec routes by sub-category", () => {
    const entries: AuditEntry[] = [
      entry({ timestamp: "2026-03-29T10:00:00Z", toolName: "read", decision: "allow" }),
      // exec with a git command should bucket into `git`, not a generic bucket.
      entry({
        timestamp: "2026-03-29T10:01:00Z",
        toolName: "exec",
        decision: "allow",
        params: { command: "git status" },
      }),
      // exec without a command falls through to scripts.
      entry({ timestamp: "2026-03-29T10:02:00Z", toolName: "exec", decision: "allow" }),
    ];
    const result = getRecentEntries(entries, 50, 0);
    // Newest first.
    expect(result[0].category).toBe("scripts");
    expect(result[1].category).toBe("git");
    expect(result[2].category).toBe("exploring");
  });
});

describe("getAgents — new fields", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 29, 14, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns all 8 new fields with correct types", () => {
    const entries: AuditEntry[] = [
      entry({
        timestamp: "2026-03-29T13:58:00Z",
        toolName: "read",
        decision: "allow",
        riskScore: 10,
        riskTier: "low",
        agentId: "test-bot",
        sessionKey: "agent:test-bot:web:session:abc",
        params: { path: "config.yaml" },
      }),
    ];
    const agents = getAgents(entries);
    expect(agents).toHaveLength(1);
    const a = agents[0];
    expect(a.mode).toBe("interactive");
    expect(a.riskPosture).toBe("calm");
    expect(a.activityBreakdown).toBeDefined();
    expect(a.activityBreakdown.exploring).toBeGreaterThan(0);
    expect(a.latestAction).toBeDefined();
    expect(a.latestActionTime).toBeDefined();
    expect(typeof a.needsAttention).toBe("boolean");
  });

  it("detects scheduled mode from cron sessionKey", () => {
    const entries: AuditEntry[] = [
      entry({
        timestamp: "2026-03-29T13:58:00Z",
        toolName: "read",
        decision: "allow",
        agentId: "scan-bot",
        sessionKey: "agent:scan-bot:cron:nightly-check",
      }),
    ];
    const agents = getAgents(entries);
    expect(agents[0].mode).toBe("scheduled");
  });

  it("sets needsAttention when agent has high peak risk", () => {
    const entries: AuditEntry[] = [
      entry({
        timestamp: "2026-03-29T13:59:00Z",
        toolName: "exec",
        decision: "allow",
        riskScore: 85,
        riskTier: "critical",
        agentId: "test-bot",
        sessionKey: "agent:test-bot:web:session:abc",
      }),
    ];
    const agents = getAgents(entries);
    expect(agents[0].needsAttention).toBe(true);
  });

  it("activityBreakdown sums to 100", () => {
    const entries: AuditEntry[] = [];
    for (let i = 0; i < 10; i++) {
      entries.push(
        entry({
          timestamp: new Date(Date.now() - i * 60000).toISOString(),
          toolName: i < 6 ? "read" : "exec",
          decision: "allow",
          agentId: "bot",
          sessionKey: "agent:bot:web:session:x",
        }),
      );
    }
    const agents = getAgents(entries);
    const sum = Object.values(agents[0].activityBreakdown).reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
  });
});

describe("getAgents — todayRiskMix aggregation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-29T14:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("bins today's decisions into tiers using the same thresholds as riskTierFromScore", () => {
    // Boundaries: >75 critical, >50 high, >25 medium, else low.
    // 26 is lowest medium (>25), 51 lowest high (>50), 76 lowest critical (>75).
    // 25 is the highest `low` value — regression guard for off-by-one.
    const scores: Array<{ score: number; tier: "low" | "medium" | "high" | "critical" }> = [
      { score: 10, tier: "low" },
      { score: 25, tier: "low" },
      { score: 26, tier: "medium" },
      { score: 50, tier: "medium" },
      { score: 51, tier: "high" },
      { score: 75, tier: "high" },
      { score: 76, tier: "critical" },
      { score: 95, tier: "critical" },
    ];
    const entries: AuditEntry[] = scores.map((s, i) =>
      entry({
        timestamp: `2026-03-29T10:${String(i).padStart(2, "0")}:00Z`,
        toolName: "read",
        decision: "allow",
        agentId: "bot",
        sessionKey: "agent:bot:main",
        riskScore: s.score,
      }),
    );

    const agents = getAgents(entries);
    expect(agents).toHaveLength(1);
    expect(agents[0].todayRiskMix).toEqual({
      low: 2,
      medium: 2,
      high: 2,
      critical: 2,
    });
  });

  it("counts only today's decisions — prior-day entries are excluded", () => {
    // Today is 2026-03-29. One medium entry today, one high entry yesterday.
    const entries: AuditEntry[] = [
      entry({
        timestamp: "2026-03-29T10:00:00Z",
        toolName: "read",
        decision: "allow",
        agentId: "bot",
        sessionKey: "agent:bot:main",
        riskScore: 40,
      }),
      entry({
        timestamp: "2026-03-28T22:00:00Z",
        toolName: "exec",
        decision: "allow",
        agentId: "bot",
        sessionKey: "agent:bot:main",
        riskScore: 60,
      }),
    ];

    const agents = getAgents(entries);
    expect(agents[0].todayRiskMix).toEqual({
      low: 0,
      medium: 1,
      high: 0,
      critical: 0,
    });
  });

  it("ignores entries with no risk score (pre-scoring timeouts, heartbeats, etc.)", () => {
    const entries: AuditEntry[] = [
      entry({
        timestamp: "2026-03-29T10:00:00Z",
        toolName: "read",
        decision: "allow",
        agentId: "bot",
        sessionKey: "agent:bot:main",
        riskScore: 10,
      }),
      entry({
        timestamp: "2026-03-29T10:01:00Z",
        toolName: "exec",
        decision: "allow",
        agentId: "bot",
        sessionKey: "agent:bot:main",
        // no riskScore
      }),
    ];

    const agents = getAgents(entries);
    expect(agents[0].todayRiskMix).toEqual({
      low: 1,
      medium: 0,
      high: 0,
      critical: 0,
    });
  });

  it("prefers LLM-adjusted score over raw riskScore for tier binning", () => {
    // Tier 1 scored at 40 (medium); LLM eval bumps it to 85 (critical). The
    // todayRiskMix bucket must reflect the final adjusted score, matching how
    // the rest of the dashboard surfaces risk.
    const entries: AuditEntry[] = [
      entry({
        timestamp: "2026-03-29T10:00:00Z",
        toolName: "exec",
        toolCallId: "tc-1",
        decision: "allow",
        agentId: "bot",
        sessionKey: "agent:bot:main",
        riskScore: 40,
      }),
      entry({
        timestamp: "2026-03-29T10:00:01Z",
        toolName: "__llm_evaluation__",
        agentId: "bot",
        refToolCallId: "tc-1",
        llmEvaluation: {
          adjustedScore: 85,
          reasoning: "actually destructive",
          tags: [],
          confidence: "high",
          patterns: [],
        },
      }),
    ];

    const agents = getAgents(entries);
    expect(agents[0].todayRiskMix).toEqual({
      low: 0,
      medium: 0,
      high: 0,
      critical: 1,
    });
  });

  it("returns all-zero mix for agents with no today decisions", () => {
    // Only a prior-day entry; no decisions today. The mix should still be
    // present on AgentInfo so the frontend can safely destructure, just zeroed.
    const entries: AuditEntry[] = [
      entry({
        timestamp: "2026-03-27T10:00:00Z",
        toolName: "read",
        decision: "allow",
        agentId: "bot",
        sessionKey: "agent:bot:main",
        riskScore: 10,
      }),
    ];

    const agents = getAgents(entries);
    expect(agents).toHaveLength(1);
    expect(agents[0].todayRiskMix).toEqual({
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    });
  });
});

describe("getRecentEntries — split session keys", () => {
  it("returns split session key for entries in a multi-run cron session", () => {
    const entries: AuditEntry[] = [
      // Run 1: morning
      entry({
        timestamp: "2026-04-10T08:00:00Z",
        toolName: "read",
        decision: "allow",
        agentId: "cron-bot",
        sessionKey: "agent:cron-bot:main",
        toolCallId: "tc-1",
      }),
      entry({
        timestamp: "2026-04-10T08:05:00Z",
        toolName: "exec",
        decision: "allow",
        agentId: "cron-bot",
        sessionKey: "agent:cron-bot:main",
        toolCallId: "tc-2",
      }),
      // Run 2: evening (>30min gap → split)
      entry({
        timestamp: "2026-04-10T14:00:00Z",
        toolName: "read",
        decision: "allow",
        agentId: "cron-bot",
        sessionKey: "agent:cron-bot:main",
        toolCallId: "tc-3",
      }),
      entry({
        timestamp: "2026-04-10T14:02:00Z",
        toolName: "write",
        decision: "allow",
        agentId: "cron-bot",
        sessionKey: "agent:cron-bot:main",
        toolCallId: "tc-4",
      }),
    ];

    const result = getRecentEntries(entries, 50, 0);
    // Reversed: tc-4, tc-3, tc-2, tc-1
    // tc-4 and tc-3 belong to run 2 → agent:cron-bot:main#2
    // tc-2 and tc-1 belong to run 1 → agent:cron-bot:main
    expect(result[0].sessionKey).toBe("agent:cron-bot:main#2");
    expect(result[1].sessionKey).toBe("agent:cron-bot:main#2");
    expect(result[2].sessionKey).toBe("agent:cron-bot:main");
    expect(result[3].sessionKey).toBe("agent:cron-bot:main");
  });

  it("preserves original session key when no split is needed", () => {
    const entries: AuditEntry[] = [
      entry({
        timestamp: "2026-04-10T08:00:00Z",
        toolName: "read",
        decision: "allow",
        sessionKey: "agent:bot:single-session",
        toolCallId: "tc-a",
      }),
      entry({
        timestamp: "2026-04-10T08:05:00Z",
        toolName: "exec",
        decision: "allow",
        sessionKey: "agent:bot:single-session",
        toolCallId: "tc-b",
      }),
    ];

    const result = getRecentEntries(entries, 50, 0);
    expect(result[0].sessionKey).toBe("agent:bot:single-session");
    expect(result[1].sessionKey).toBe("agent:bot:single-session");
  });
});

describe("resolveSplitKeyForEntry", () => {
  it("returns split key for entry in second run of a split session", () => {
    const entries: AuditEntry[] = [
      entry({
        timestamp: "2026-04-10T08:00:00Z",
        sessionKey: "agent:cron:main",
        toolCallId: "run1-tc",
      }),
      entry({
        timestamp: "2026-04-10T14:00:00Z",
        sessionKey: "agent:cron:main",
        toolCallId: "run2-tc",
      }),
    ];
    const target = entries[1]; // second run entry
    expect(resolveSplitKeyForEntry(entries, target)).toBe("agent:cron:main#2");
  });

  it("returns original key when entry is in the first run", () => {
    const entries: AuditEntry[] = [
      entry({
        timestamp: "2026-04-10T08:00:00Z",
        sessionKey: "agent:cron:main",
        toolCallId: "run1-tc",
      }),
      entry({
        timestamp: "2026-04-10T14:00:00Z",
        sessionKey: "agent:cron:main",
        toolCallId: "run2-tc",
      }),
    ];
    const target = entries[0]; // first run entry
    expect(resolveSplitKeyForEntry(entries, target)).toBe("agent:cron:main");
  });

  it("returns original key when session has no splits", () => {
    const entries: AuditEntry[] = [
      entry({
        timestamp: "2026-04-10T08:00:00Z",
        sessionKey: "agent:bot:session",
        toolCallId: "tc-1",
      }),
      entry({
        timestamp: "2026-04-10T08:02:00Z",
        sessionKey: "agent:bot:session",
        toolCallId: "tc-2",
      }),
    ];
    expect(resolveSplitKeyForEntry(entries, entries[0])).toBe("agent:bot:session");
    expect(resolveSplitKeyForEntry(entries, entries[1])).toBe("agent:bot:session");
  });

  it("returns undefined for entries without a session key", () => {
    const e = entry({ timestamp: "2026-04-10T08:00:00Z", toolCallId: "tc-x" });
    expect(resolveSplitKeyForEntry([e], e)).toBeUndefined();
  });

  it("handles three-way split correctly", () => {
    const entries: AuditEntry[] = [
      entry({ timestamp: "2026-04-10T06:00:00Z", sessionKey: "s", toolCallId: "a" }),
      entry({ timestamp: "2026-04-10T10:00:00Z", sessionKey: "s", toolCallId: "b" }),
      entry({ timestamp: "2026-04-10T16:00:00Z", sessionKey: "s", toolCallId: "c" }),
    ];
    expect(resolveSplitKeyForEntry(entries, entries[0])).toBe("s");
    expect(resolveSplitKeyForEntry(entries, entries[1])).toBe("s#2");
    expect(resolveSplitKeyForEntry(entries, entries[2])).toBe("s#3");
  });
});
