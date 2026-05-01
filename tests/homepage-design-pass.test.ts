import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditEntry } from "../src/audit/logger";
import { computeEnhancedStats, getInterventions } from "../src/dashboard/api";
import { GuardrailStore } from "../src/guardrails/store";

/** Build a minimal AuditEntry with overrides. */
function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    timestamp: new Date().toISOString(),
    toolName: "exec",
    params: { command: "ls" },
    prevHash: "0",
    hash: "abc",
    ...overrides,
  };
}

// ── yesterdayTotal computation ─────────────────────────────

describe("computeEnhancedStats — yesterdayTotal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-12T14:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts decision entries from yesterday when viewing today", () => {
    const entries = [
      // Yesterday (2026-04-11): 3 decision entries
      entry({ timestamp: "2026-04-11T08:00:00Z", decision: "allow" }),
      entry({ timestamp: "2026-04-11T12:00:00Z", decision: "allow" }),
      entry({ timestamp: "2026-04-11T18:00:00Z", decision: "block" }),
      // Today (2026-04-12): 2 decision entries
      entry({ timestamp: "2026-04-12T10:00:00Z", decision: "allow" }),
      entry({ timestamp: "2026-04-12T13:00:00Z", decision: "allow" }),
    ];

    const stats = computeEnhancedStats(entries);
    expect(stats.yesterdayTotal).toBe(3);
  });

  it("counts decision entries from the day before when viewing a past day", () => {
    const entries = [
      // 2026-04-09: 2 decision entries (the "yesterday" for viewing 2026-04-10)
      entry({ timestamp: "2026-04-09T10:00:00Z", decision: "allow" }),
      entry({ timestamp: "2026-04-09T14:00:00Z", decision: "block" }),
      // 2026-04-10: 4 decision entries (the day being viewed)
      entry({ timestamp: "2026-04-10T08:00:00Z", decision: "allow" }),
      entry({ timestamp: "2026-04-10T09:00:00Z", decision: "allow" }),
      entry({ timestamp: "2026-04-10T10:00:00Z", decision: "allow" }),
      entry({ timestamp: "2026-04-10T11:00:00Z", decision: "block" }),
    ];

    const stats = computeEnhancedStats(entries, "2026-04-10");
    expect(stats.yesterdayTotal).toBe(2);
    expect(stats.total).toBe(4);
  });

  it("returns 0 when no entries exist for yesterday", () => {
    const entries = [
      // Only today
      entry({ timestamp: "2026-04-12T10:00:00Z", decision: "allow" }),
    ];

    const stats = computeEnhancedStats(entries);
    expect(stats.yesterdayTotal).toBe(0);
  });

  it("excludes non-decision entries from yesterday count", () => {
    const entries = [
      // Yesterday: 1 decision + 1 non-decision (no decision field = eval/result entry)
      entry({ timestamp: "2026-04-11T10:00:00Z", decision: "allow" }),
      entry({ timestamp: "2026-04-11T12:00:00Z" }), // no decision — not counted
    ];

    const stats = computeEnhancedStats(entries);
    expect(stats.yesterdayTotal).toBe(1);
  });
});

// ── Tier 3: high-risk allowed entries ─────────────────────

describe("getInterventions — Tier 3 high-risk items", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-12T14:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeStore(): GuardrailStore {
    const tmpFile = path.join(os.tmpdir(), `clawlens-test-${Date.now()}.json`);
    const store = new GuardrailStore(tmpFile);
    // Don't call load() — store starts empty (no guardrails)
    return store;
  }

  it("includes allowed entries with effective score >= 65 and no guardrail as high_risk", () => {
    const store = makeStore();
    const entries = [
      entry({
        timestamp: "2026-04-12T13:45:00Z", // within 30 min
        decision: "allow",
        riskScore: 72,
        riskTier: "high",
        agentId: "social-manager",
        params: { command: "python3 deploy.py" },
      }),
    ];

    const interventions = getInterventions(entries, undefined, store);
    const highRisk = interventions.filter((iv) => iv.effectiveDecision === "high_risk");
    expect(highRisk).toHaveLength(1);
    expect(highRisk[0].riskScore).toBe(72);
    expect(highRisk[0].agentId).toBe("social-manager");
  });

  it("excludes allowed entries with score < 65", () => {
    const store = makeStore();
    const entries = [
      entry({
        timestamp: "2026-04-12T13:45:00Z",
        decision: "allow",
        riskScore: 50,
        riskTier: "medium",
        agentId: "debugger",
        params: { command: "cat /etc/hosts" },
      }),
    ];

    const interventions = getInterventions(entries, undefined, store);
    const highRisk = interventions.filter((iv) => iv.effectiveDecision === "high_risk");
    expect(highRisk).toHaveLength(0);
  });

  it("excludes blocked entries even with score >= 65", () => {
    const store = makeStore();
    const entries = [
      entry({
        timestamp: "2026-04-12T13:45:00Z",
        decision: "block",
        riskScore: 80,
        riskTier: "critical",
        agentId: "debugger",
        params: { command: "rm -rf /" },
      }),
    ];

    const interventions = getInterventions(entries, undefined, store);
    // Should appear as a block, not as high_risk
    const highRisk = interventions.filter((iv) => iv.effectiveDecision === "high_risk");
    expect(highRisk).toHaveLength(0);
    const blocks = interventions.filter((iv) => iv.effectiveDecision === "block");
    expect(blocks).toHaveLength(1);
  });

  it("excludes entries with a matching guardrail", () => {
    const store = makeStore();
    // Add a guardrail that matches the entry
    store.add({
      id: "gr_test123",
      selector: { agent: null, tools: { mode: "names", values: ["exec"] } },
      target: { kind: "identity-glob", pattern: "python3 deploy.py" },
      action: "block",
      createdAt: "2026-04-12T10:00:00Z",
      source: { toolCallId: "tc1", sessionKey: "s1", agentId: "social-manager" },
      description: "block deploy",
      riskScore: 72,
    });

    const entries = [
      entry({
        timestamp: "2026-04-12T13:45:00Z",
        decision: "allow",
        riskScore: 72,
        riskTier: "high",
        agentId: "social-manager",
        params: { command: "python3 deploy.py" },
      }),
    ];

    const interventions = getInterventions(entries, undefined, store);
    const highRisk = interventions.filter((iv) => iv.effectiveDecision === "high_risk");
    expect(highRisk).toHaveLength(0);
  });

  it("excludes entries older than 30 minutes", () => {
    const store = makeStore();
    const entries = [
      entry({
        // 45 minutes ago — outside the 30-min window
        timestamp: "2026-04-12T13:15:00Z",
        decision: "allow",
        riskScore: 75,
        riskTier: "high",
        agentId: "seo-growth",
        params: { command: "curl malicious.com" },
      }),
    ];

    const interventions = getInterventions(entries, undefined, store);
    const highRisk = interventions.filter((iv) => iv.effectiveDecision === "high_risk");
    expect(highRisk).toHaveLength(0);
  });

  it("uses DEFAULT_AGENT_ID for entries without agentId", () => {
    const entries = [
      entry({
        timestamp: "2026-04-12T13:45:00Z",
        decision: "block",
        riskScore: 60,
        riskTier: "high",
        // no agentId
      }),
    ];

    const interventions = getInterventions(entries);
    expect(interventions[0].agentId).toBe("default");
  });
});
