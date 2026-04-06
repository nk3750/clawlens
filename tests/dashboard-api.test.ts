import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as crypto from "node:crypto";
import {
  computeStats,
  computeEnhancedStats,
  getRecentEntries,
  checkHealth,
  getEffectiveDecision,
  getAgents,
} from "../src/dashboard/api";
import {
  getCategory,
  computeBreakdown,
  parseSessionContext,
  describeAction,
  riskPosture,
} from "../src/dashboard/categories";
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

describe("getEffectiveDecision", () => {
  it("maps userResponse over raw decision", () => {
    expect(getEffectiveDecision(entry({ decision: "approval_required", userResponse: "approved" }))).toBe("approved");
    expect(getEffectiveDecision(entry({ decision: "approval_required", userResponse: "denied" }))).toBe("denied");
    expect(getEffectiveDecision(entry({ decision: "approval_required", userResponse: "timeout" }))).toBe("timeout");
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
    vi.setSystemTime(new Date("2026-03-29T14:00:00Z"));
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
      entry({ timestamp: "2026-03-29T10:05:00Z", decision: "approval_required", userResponse: "timeout" }),
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

  it("only counts entries from today (UTC)", () => {
    const entries: AuditEntry[] = [
      entry({ timestamp: "2026-03-28T23:59:59Z", decision: "allow" }), // yesterday
      entry({ timestamp: "2026-03-29T00:00:00Z", decision: "allow" }), // today
      entry({ timestamp: "2026-03-29T13:00:00Z", decision: "block" }), // today
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
    entry({ timestamp: "2026-03-29T10:03:00Z", toolName: "message", decision: "approval_required", userResponse: "approved" }),
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
        const hash = crypto
          .createHash("sha256")
          .update(JSON.stringify(base))
          .digest("hex");
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
  it("maps known tools to their categories", () => {
    expect(getCategory("read")).toBe("exploring");
    expect(getCategory("search")).toBe("exploring");
    expect(getCategory("glob")).toBe("exploring");
    expect(getCategory("grep")).toBe("exploring");
    expect(getCategory("write")).toBe("changes");
    expect(getCategory("edit")).toBe("changes");
    expect(getCategory("exec")).toBe("commands");
    expect(getCategory("fetch_url")).toBe("web");
    expect(getCategory("message")).toBe("comms");
  });

  it("defaults unknown tools to commands", () => {
    expect(getCategory("some_custom_tool")).toBe("commands");
  });
});

describe("computeBreakdown", () => {
  it("returns correct percentages summing to 100", () => {
    const entries = [
      { toolName: "read" },
      { toolName: "read" },
      { toolName: "read" },
      { toolName: "write" },
      { toolName: "exec" },
    ];
    const breakdown = computeBreakdown(entries);
    expect(breakdown.exploring).toBe(60);
    expect(breakdown.changes).toBe(20);
    expect(breakdown.commands).toBe(20);
    const sum = Object.values(breakdown).reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
  });

  it("handles empty entries", () => {
    const breakdown = computeBreakdown([]);
    const sum = Object.values(breakdown).reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
  });
});

describe("parseSessionContext", () => {
  it("parses cron sessions", () => {
    expect(parseSessionContext("agent:nightly-scan:cron:daily-audit")).toBe("daily-audit");
  });

  it("parses telegram sessions", () => {
    expect(parseSessionContext("agent:main:telegram:direct:123")).toBe("via Telegram");
  });

  it("parses web sessions", () => {
    expect(parseSessionContext("agent:main:web:session:abc")).toBe("via Web");
  });

  it("returns undefined for short keys", () => {
    expect(parseSessionContext("ab")).toBeUndefined();
  });
});

describe("describeAction", () => {
  it("describes read actions", () => {
    expect(describeAction({ toolName: "read", params: { path: "config.yaml" } })).toBe("Read config.yaml");
  });

  it("describes exec actions using parseExecCommand", () => {
    const desc = describeAction({ toolName: "exec", params: { command: "npm test" } });
    expect(desc).toContain("Run");
    expect(desc).toContain("npm");
  });

  it("describes message actions", () => {
    const desc = describeAction({ toolName: "message", params: { to: "boss@co.com", subject: "Report" } });
    expect(desc).toContain("Report");
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
    vi.setSystemTime(new Date("2026-03-29T14:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns riskPosture as valid string enum", () => {
    const entries: AuditEntry[] = [
      entry({ timestamp: "2026-03-29T10:00:00Z", decision: "allow", riskScore: 15, riskTier: "low" }),
      entry({ timestamp: "2026-03-29T10:01:00Z", decision: "allow", riskScore: 10, riskTier: "low" }),
    ];
    const stats = computeEnhancedStats(entries);
    expect(["calm", "elevated", "high", "critical"]).toContain(stats.riskPosture);
    expect(stats.riskPosture).toBe("calm");
  });

  it("overrides riskPosture to critical if recent block", () => {
    const entries: AuditEntry[] = [
      entry({ timestamp: "2026-03-29T13:45:00Z", decision: "block", riskScore: 30, riskTier: "medium" }),
    ];
    const stats = computeEnhancedStats(entries);
    expect(stats.riskPosture).toBe("critical");
  });
});

describe("getRecentEntries — category field", () => {
  it("includes category on each entry", () => {
    const entries: AuditEntry[] = [
      entry({ timestamp: "2026-03-29T10:00:00Z", toolName: "read", decision: "allow" }),
      entry({ timestamp: "2026-03-29T10:01:00Z", toolName: "exec", decision: "allow" }),
    ];
    const result = getRecentEntries(entries, 50, 0);
    expect(result[0].category).toBe("commands");
    expect(result[1].category).toBe("exploring");
  });
});

describe("getAgents — new fields", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-29T14:00:00Z"));
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
    expect(a.latestAction).toBe("Read config.yaml");
    expect(a.latestActionTime).toBeDefined();
    expect(a.needsAttention).toBe(false);
    expect(a.currentContext).toBe("via Web");
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

  it("sets needsAttention when pending approval exists", () => {
    const entries: AuditEntry[] = [
      entry({
        timestamp: "2026-03-29T13:59:00Z",
        toolName: "message",
        decision: "approval_required",
        agentId: "test-bot",
        sessionKey: "agent:test-bot:web:session:abc",
      }),
    ];
    const agents = getAgents(entries);
    expect(agents[0].needsAttention).toBe(true);
    expect(agents[0].attentionReason).toContain("Pending approval");
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
