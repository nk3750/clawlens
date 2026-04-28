import * as crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditEntry } from "../src/audit/logger";
import {
  checkHealth,
  computeEnhancedStats,
  computeFleetRiskIndex,
  computeStats,
  getAgents,
  getEffectiveDecision,
  getEffectiveTier,
  getRecentEntries,
  mapEntry,
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
  // Production audit rows always carry riskTier alongside riskScore — both
  // come from the same RiskScore object in computeRiskScore. Mirror that
  // invariant here so fixtures opting into a score automatically get a
  // matching tier (canonical thresholds from src/risk/scorer.ts:265-270:
  // >=80 critical, >=60 high, >=30 medium, else low). Avoids salting every
  // fixture with a tier field that's really an implementation detail of the
  // scorer. Explicit overrides.riskTier still wins via the spread below.
  const score = overrides.riskScore;
  const defaultTier: AuditEntry["riskTier"] | undefined =
    score === undefined
      ? undefined
      : score >= 80
        ? "critical"
        : score >= 60
          ? "high"
          : score >= 30
            ? "medium"
            : "low";
  return {
    timestamp: new Date().toISOString(),
    toolName: "exec",
    params: {},
    prevHash: "0",
    hash: "abc",
    ...(defaultTier ? { riskTier: defaultTier } : {}),
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

describe("getEffectiveTier", () => {
  // Single source of truth for tier lookup across getAgents.todayRiskMix /
  // .riskProfile, computeFleetRiskIndex.{critCount,highCount}, and
  // computeEnhancedStats.{low,medium,high,critical}. Resolution order:
  //   1. LLM-eval entry's persisted riskTier (LLM-adjusted wins, mirrors
  //      getEffectiveScore precedence)
  //   2. Raw entry's persisted riskTier
  //   3. decision === "block"            → "critical"
  //   4. decision === "approval_required" → "high"
  //   5. otherwise undefined (caller drops from histograms)
  // Helper deliberately does NOT bucket from score — riskTier is set in
  // lockstep with riskScore in production, so deriving tier here would
  // duplicate computeRiskScore's threshold logic and create drift risk.

  it("uses the eval entry's riskTier when present (LLM-adjusted wins)", () => {
    const evalIdx = new Map<string, AuditEntry>([
      ["tc-1", entry({ refToolCallId: "tc-1", riskTier: "critical", llmEvaluation: undefined })],
    ]);
    const raw = entry({ toolCallId: "tc-1", decision: "allow", riskTier: "low" });
    expect(getEffectiveTier(raw, evalIdx)).toBe("critical");
  });

  it("falls back to raw entry's riskTier when no eval entry exists", () => {
    const raw = entry({ toolCallId: "tc-2", decision: "allow", riskTier: "high" });
    expect(getEffectiveTier(raw, new Map())).toBe("high");
  });

  it("falls back to raw entry's riskTier when eval entry has no tier", () => {
    const evalIdx = new Map<string, AuditEntry>([
      ["tc-3", entry({ refToolCallId: "tc-3" })], // no riskTier on eval
    ]);
    const raw = entry({ toolCallId: "tc-3", decision: "allow", riskTier: "medium" });
    expect(getEffectiveTier(raw, evalIdx)).toBe("medium");
  });

  it("buckets unscored decision=block as critical (guardrail-block fallback)", () => {
    const raw = entry({ decision: "block" });
    delete raw.riskTier;
    delete raw.riskScore;
    expect(getEffectiveTier(raw, new Map())).toBe("critical");
  });

  it("buckets unscored decision=approval_required as high (guardrail-approval fallback)", () => {
    const raw = entry({ decision: "approval_required" });
    delete raw.riskTier;
    delete raw.riskScore;
    expect(getEffectiveTier(raw, new Map())).toBe("high");
  });

  it("returns undefined for unscored decision=allow (no useful tier signal)", () => {
    const raw = entry({ decision: "allow" });
    delete raw.riskTier;
    delete raw.riskScore;
    expect(getEffectiveTier(raw, new Map())).toBeUndefined();
  });

  it("returns undefined for unscored userResponse=timeout (no useful tier signal)", () => {
    // Approval that timed out without a stored tier — no signal, drops.
    const raw = entry({ decision: "approval_required", userResponse: "timeout" });
    delete raw.riskTier;
    delete raw.riskScore;
    // The raw decision is approval_required, so the helper still buckets to
    // "high" — userResponse doesn't override the decision-based fallback.
    // This test exists so a future change to look at userResponse won't drift
    // silently — flip the expected to undefined the day we want it to.
    expect(getEffectiveTier(raw, new Map())).toBe("high");
  });

  it("returns undefined for an entry with no decision and no risk fields", () => {
    const raw = entry({}); // result entries, heartbeats, eval-only writes
    delete raw.riskTier;
    delete raw.riskScore;
    delete raw.decision;
    expect(getEffectiveTier(raw, new Map())).toBeUndefined();
  });
});

describe("mapEntry — riskTier", () => {
  // Regression lock for #32: mapEntry's riskTier must agree with
  // getEffectiveTier so the filter side (post-#31) and response side surface
  // the same tier label. Otherwise unscored approval_required / block entries
  // pass the filter but come out null in the response (and over the SSE feed
  // at routes.ts:496, where 5+ frontend components read entry.riskTier
  // directly).
  it("returns 'high' for an approval_required entry with no raw tier and no eval", () => {
    const raw = entry({
      toolCallId: "tc-pending",
      decision: "approval_required",
    });
    delete raw.riskTier;
    const result = mapEntry(raw, new Map());
    expect(result.riskTier).toBe("high");
  });

  it("returns 'critical' for a block entry with no raw tier and no eval", () => {
    const raw = entry({
      toolCallId: "tc-blocked",
      decision: "block",
    });
    delete raw.riskTier;
    const result = mapEntry(raw, new Map());
    expect(result.riskTier).toBe("critical");
  });

  it("uses eval entry's riskTier when present (LLM-adjusted wins)", () => {
    const raw = entry({
      toolCallId: "tc-eval",
      decision: "allow",
      riskTier: "high",
    });
    const evalRow = entry({
      timestamp: "2026-04-25T12:00:01Z",
      toolName: "__llm_evaluation__",
      refToolCallId: "tc-eval",
      riskTier: "low",
      llmEvaluation: {
        adjustedScore: 10,
        reasoning: "downgraded",
        tags: [],
        confidence: "high",
        patterns: [],
      },
    });
    const evalIdx = new Map([["tc-eval", evalRow]]);
    const result = mapEntry(raw, evalIdx);
    expect(result.riskTier).toBe("low");
  });

  it("falls back to raw entry's riskTier when no eval and no decision fallback applies", () => {
    const raw = entry({
      toolCallId: "tc-raw",
      decision: "allow",
      riskScore: 35,
      riskTier: "medium",
    });
    const result = mapEntry(raw, new Map());
    expect(result.riskTier).toBe("medium");
  });
});

describe("getEffectiveTier — cross-aggregation reconciliation", () => {
  // The whole point of centralizing the helper: every aggregation that buckets
  // by tier (todayRiskMix, riskProfile, fleet-risk-index counts, enhanced-stats
  // counts) produces consistent numbers for the same fixture. If a row is
  // bucketed as critical in one place and dropped in another, the dashboard
  // shows numbers that don't reconcile (the bug fd94778 fixed for one site).
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 29, 14, 0, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts the same critical/high totals across getAgents, computeFleetRiskIndex, and computeEnhancedStats", () => {
    // Fixture: 3 today-decisions for the same agent — one block (no riskTier
    // → critical via fallback), one approval_required (no riskTier → high),
    // one allow with explicit riskTier=critical. Expected per-tier counts:
    //   critical = 2 (block fallback + explicit critical)
    //   high     = 1 (approval_required fallback)
    const todayIso = new Date(2026, 2, 29, 13, 0, 0).toISOString();
    const blockRow = entry({
      timestamp: todayIso,
      toolName: "exec",
      decision: "block",
      agentId: "baddie",
      sessionKey: "agent:baddie:main",
    });
    delete blockRow.riskScore;
    delete blockRow.riskTier;
    const apprRow = entry({
      timestamp: todayIso,
      toolName: "exec",
      decision: "approval_required",
      agentId: "baddie",
      sessionKey: "agent:baddie:main",
    });
    delete apprRow.riskScore;
    delete apprRow.riskTier;
    const critRow = entry({
      timestamp: todayIso,
      toolName: "exec",
      decision: "allow",
      agentId: "baddie",
      sessionKey: "agent:baddie:main",
      riskScore: 90,
      riskTier: "critical",
    });
    const entries: AuditEntry[] = [blockRow, apprRow, critRow];

    const agents = getAgents(entries);
    expect(agents).toHaveLength(1);
    expect(agents[0].todayRiskMix).toEqual({ low: 0, medium: 0, high: 1, critical: 2 });
    // riskProfile is all-time; with three entries today it equals todayRiskMix.
    expect(agents[0].riskProfile).toEqual({ low: 0, medium: 0, high: 1, critical: 2 });

    const fleet = computeFleetRiskIndex(entries);
    expect(fleet.critCount).toBe(2);
    expect(fleet.highCount).toBe(1);
    expect(fleet.totalElevated).toBe(3);

    const stats = computeEnhancedStats(entries);
    expect(stats.riskBreakdown).toEqual({ low: 0, medium: 0, high: 1, critical: 2 });
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

  it("leaves lastEntryTimestamp undefined when log is empty", () => {
    const result = checkHealth([]);
    expect(result.lastEntryTimestamp).toBeUndefined();
  });

  it("populates lastEntryTimestamp with the newest entry's timestamp", () => {
    // Newest is the middle entry. Order should not matter — checkHealth
    // takes a max scan.
    const entries: AuditEntry[] = [
      entry({ timestamp: "2026-04-01T10:00:00.000Z" }),
      entry({ timestamp: "2026-04-01T11:30:00.000Z" }),
      entry({ timestamp: "2026-04-01T09:15:00.000Z" }),
    ];
    const result = checkHealth(entries);
    expect(result.lastEntryTimestamp).toBe("2026-04-01T11:30:00.000Z");
  });

  it("returns the lone entry's timestamp when the log has a single row", () => {
    const entries: AuditEntry[] = [entry({ timestamp: "2026-04-01T08:00:00.000Z" })];
    expect(checkHealth(entries).lastEntryTimestamp).toBe("2026-04-01T08:00:00.000Z");
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
    const desc = describeAction({ toolName: "message", params: { target: "boss@co.com" } });
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

describe("getRecentEntries — riskTier filter", () => {
  // Regression lock for #28: the riskTier filter must compare against the
  // *effective* tier (LLM-eval override wins, falling back to raw entry's
  // tier), not the raw audit entry's tier alone. Otherwise the predicate
  // and the response (mapEntry uses evalEntry?.riskTier ?? entry.riskTier)
  // disagree and rows of every tier leak through `?riskTier=high`.
  it("filters by LLM-adjusted tier when an eval entry overrides the raw tier", () => {
    const raw = entry({
      toolCallId: "tc-adjusted",
      decision: "allow",
      riskTier: "high",
    });
    const evalRow = entry({
      timestamp: "2026-04-25T12:00:01Z",
      toolName: "__llm_evaluation__",
      refToolCallId: "tc-adjusted",
      // Production writes riskTier alongside adjustedScore on eval entries —
      // mirror the canonical fixture used elsewhere in this file.
      riskTier: "low",
      llmEvaluation: {
        adjustedScore: 10,
        reasoning: "downgraded by LLM",
        tags: [],
        confidence: "high",
        patterns: [],
      },
    });
    const entries = [raw, evalRow];

    const filteredLow = getRecentEntries(entries, 50, 0, { riskTier: "low" });
    expect(filteredLow.map((e) => e.toolCallId)).toContain("tc-adjusted");

    const filteredHigh = getRecentEntries(entries, 50, 0, { riskTier: "high" });
    expect(filteredHigh.map((e) => e.toolCallId)).not.toContain("tc-adjusted");
  });

  it("filters by raw tier when no eval entry exists", () => {
    const raw = entry({
      toolCallId: "tc-raw-only",
      decision: "allow",
      riskTier: "critical",
    });
    const result = getRecentEntries([raw], 50, 0, { riskTier: "critical" });
    expect(result.map((e) => e.toolCallId)).toContain("tc-raw-only");

    const negative = getRecentEntries([raw], 50, 0, { riskTier: "low" });
    expect(negative).toHaveLength(0);
  });
});

describe("getRecentEntries — q filter", () => {
  // Phase 2.7 (#35): free-text substring filter against four fields per entry:
  //   toolName, JSON.stringify(params), agentId ?? '', sessionKey ?? ''
  // Case-insensitive literal substring; no regex / wildcard support. Mirrors
  // dashboard/src/lib/activityFilters.ts::matchesFilters so SSE-incoming rows
  // and server-fetched rows agree.
  const entries: AuditEntry[] = [
    entry({
      timestamp: "2026-04-26T10:00:00Z",
      toolName: "exec",
      decision: "allow",
      agentId: "alpha",
      sessionKey: "sess_alpha_1",
      toolCallId: "tc_q1",
      params: { command: "ssh prod-db" },
      riskScore: 70,
    }),
    entry({
      timestamp: "2026-04-26T10:01:00Z",
      toolName: "fetch",
      decision: "allow",
      agentId: "beta",
      sessionKey: "sess_beta_1",
      toolCallId: "tc_q2",
      params: { url: "https://api.example.com/users" },
      riskScore: 10,
    }),
    entry({
      timestamp: "2026-04-26T10:02:00Z",
      toolName: "read",
      decision: "allow",
      agentId: "alpha",
      sessionKey: "sess_alpha_2",
      toolCallId: "tc_q3",
      params: { path: "/etc/passwd" },
      riskScore: 35,
    }),
    entry({
      timestamp: "2026-04-26T10:03:00Z",
      toolName: "write",
      decision: "block",
      agentId: "gamma",
      sessionKey: "sess_gamma_1",
      toolCallId: "tc_q4",
      params: { command: "rm -rf /" },
      riskScore: 95,
    }),
  ];

  it("matches against toolName (case-insensitive)", () => {
    const result = getRecentEntries(entries, 50, 0, { q: "EXEC" });
    expect(result.map((e) => e.toolCallId)).toEqual(["tc_q1"]);
  });

  it("matches against params.command via JSON.stringify", () => {
    const result = getRecentEntries(entries, 50, 0, { q: "ssh" });
    expect(result.map((e) => e.toolCallId)).toEqual(["tc_q1"]);
  });

  it("matches against params.url via JSON.stringify", () => {
    const result = getRecentEntries(entries, 50, 0, { q: "api.example" });
    expect(result.map((e) => e.toolCallId)).toEqual(["tc_q2"]);
  });

  it("matches against params.path via JSON.stringify", () => {
    const result = getRecentEntries(entries, 50, 0, { q: "passwd" });
    expect(result.map((e) => e.toolCallId)).toEqual(["tc_q3"]);
  });

  it("matches against agentId", () => {
    const result = getRecentEntries(entries, 50, 0, { q: "gamma" });
    expect(result.map((e) => e.toolCallId)).toEqual(["tc_q4"]);
  });

  it("matches against sessionKey", () => {
    const result = getRecentEntries(entries, 50, 0, { q: "sess_beta" });
    expect(result.map((e) => e.toolCallId)).toEqual(["tc_q2"]);
  });

  it("returns empty array when nothing matches", () => {
    const result = getRecentEntries(entries, 50, 0, { q: "nothing-matches-this" });
    expect(result).toEqual([]);
  });

  it("intersects with riskTier — only rows matching BOTH q and tier", () => {
    // tc_q4 alone is critical (riskScore 95 → critical) and has 'rm' in
    // params. tc_q1 matches "exec" but is high tier. The intersection of
    // q="rm" + tier="critical" is just tc_q4.
    const result = getRecentEntries(entries, 50, 0, { q: "rm", riskTier: "critical" });
    expect(result.map((e) => e.toolCallId)).toEqual(["tc_q4"]);

    // q matches multiple rows but tier filter narrows to one.
    const result2 = getRecentEntries(entries, 50, 0, { q: "alpha", riskTier: "high" });
    expect(result2.map((e) => e.toolCallId)).toEqual(["tc_q1"]);
  });

  it("intersects with since — only rows inside the time window AND matching q", () => {
    vi.useFakeTimers();
    try {
      // Sit at 10:01:30 so only entries at/after 10:00:30 fall in the last
      // hour: tc_q2, tc_q3, tc_q4. Then q="alpha" pulls just tc_q3.
      vi.setSystemTime(new Date("2026-04-26T11:01:30Z"));
      const result = getRecentEntries(entries, 50, 0, { q: "alpha", since: "1h" });
      expect(result.map((e) => e.toolCallId)).toEqual(["tc_q3"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats empty string as absent (no filter applied)", () => {
    // Server-side defense: routes.ts only sets q when non-empty, but a direct
    // call with q: '' should not silently zero the result set.
    const all = getRecentEntries(entries, 50, 0);
    const withEmpty = getRecentEntries(entries, 50, 0, { q: "" });
    expect(withEmpty.map((e) => e.toolCallId)).toEqual(all.map((e) => e.toolCallId));
  });

  it("preserves unicode substring matches (codepoint-level)", () => {
    const cafe = entry({
      timestamp: "2026-04-26T10:05:00Z",
      toolName: "exec",
      decision: "allow",
      agentId: "delta",
      sessionKey: "sess_delta_1",
      toolCallId: "tc_q_cafe",
      params: { command: "café" },
    });
    const result = getRecentEntries([cafe], 50, 0, { q: "café" });
    expect(result.map((e) => e.toolCallId)).toEqual(["tc_q_cafe"]);
  });

  it("treats q as a literal substring (no regex special-char handling)", () => {
    const literal = entry({
      timestamp: "2026-04-26T10:06:00Z",
      toolName: "exec",
      decision: "allow",
      agentId: "alpha",
      sessionKey: "sess_lit",
      toolCallId: "tc_q_lit",
      params: { command: "echo a*b" },
    });
    const matches = getRecentEntries([literal], 50, 0, { q: "a*b" });
    expect(matches.map((e) => e.toolCallId)).toEqual(["tc_q_lit"]);
    // 'a.b' would only match if regex (the . wildcard) — must NOT match.
    const noRegex = getRecentEntries([literal], 50, 0, { q: "a.b" });
    expect(noRegex).toEqual([]);
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

  it("bins today's decisions into tiers using the canonical scorer thresholds", () => {
    // Canonical boundaries (src/risk/scorer.ts:265-270, mirrored by the test
    // fixture's auto-derived riskTier above): >=80 critical, >=60 high,
    // >=30 medium, else low. The bucketing comes from the persisted riskTier
    // via getEffectiveTier — no inline score thresholds in api.ts. Values
    // chosen to land exactly at each boundary:
    //   29 is the highest `low`; 30 is the lowest `medium`;
    //   59 is the highest `medium`; 60 is the lowest `high`;
    //   79 is the highest `high`;   80 is the lowest `critical`.
    const scores: Array<{ score: number; tier: "low" | "medium" | "high" | "critical" }> = [
      { score: 10, tier: "low" },
      { score: 29, tier: "low" },
      { score: 30, tier: "medium" },
      { score: 59, tier: "medium" },
      { score: 60, tier: "high" },
      { score: 79, tier: "high" },
      { score: 80, tier: "critical" },
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

  it("buckets unscored decision=block entries as critical (guardrail-block backfill)", () => {
    // logGuardrailMatch writes audit rows with decision=block but no riskScore
    // for entries written before A landed. They were silently dropped from
    // todayRiskMix while still counting in todayToolCalls, leaving an empty
    // segment on the per-agent risk-mix bar. Treat them as critical — a fired
    // user-defined block is the strongest risk signal we have.
    const entries: AuditEntry[] = [
      entry({
        timestamp: "2026-03-29T10:00:00Z",
        toolName: "exec",
        decision: "block",
        agentId: "baddie",
        sessionKey: "agent:baddie:main",
        // no riskScore — historical guardrail-match row
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

  it("buckets unscored decision=approval_required entries as high (guardrail-approval backfill)", () => {
    // Same shape as block, but the approval branch sits one tier below — the
    // user gated the action but didn't outright forbid it.
    const entries: AuditEntry[] = [
      entry({
        timestamp: "2026-03-29T10:00:00Z",
        toolName: "exec",
        decision: "approval_required",
        agentId: "baddie",
        sessionKey: "agent:baddie:main",
        // no riskScore — historical guardrail-match row
      }),
    ];

    const agents = getAgents(entries);
    expect(agents[0].todayRiskMix).toEqual({
      low: 0,
      medium: 0,
      high: 1,
      critical: 0,
    });
  });

  it("does NOT backfill unscored decision=allow entries (no useful signal — preserves existing behavior)", () => {
    // Regression lock for the existing "ignores entries with no risk score"
    // test above: the backfill must only fire on block / approval_required.
    // An unscored allow entry still has nothing meaningful to bucket, so we
    // continue dropping it from the mix.
    const entries: AuditEntry[] = [
      entry({
        timestamp: "2026-03-29T10:00:00Z",
        toolName: "exec",
        decision: "allow",
        agentId: "baddie",
        sessionKey: "agent:baddie:main",
        // no riskScore
      }),
    ];

    const agents = getAgents(entries);
    expect(agents[0].todayRiskMix).toEqual({
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    });
  });

  it("scored entries take precedence over the decision-based fallback (no double-count)", () => {
    // An entry with both decision=block AND a real riskScore must bucket by
    // the score (here medium=40), not the decision-based critical fallback.
    // Locks the implementation into "fallback only when score undefined".
    const entries: AuditEntry[] = [
      entry({
        timestamp: "2026-03-29T10:00:00Z",
        toolName: "exec",
        decision: "block",
        agentId: "baddie",
        sessionKey: "agent:baddie:main",
        riskScore: 40,
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
        // Production writes riskTier alongside adjustedScore on eval entries
        // (src/hooks/before-tool-call.ts:191-195, 232, 243, 283). getEffectiveTier
        // reads the persisted tier directly — mirror the production invariant.
        riskTier: "critical",
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
