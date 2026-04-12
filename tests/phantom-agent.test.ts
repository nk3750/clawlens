import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditEntry } from "../src/audit/logger";
import { DEFAULT_AGENT_ID, getAgents } from "../src/dashboard/api";

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

describe("getAgents — phantom agent elimination", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-12T14:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not create 'default' agent from result entries without agentId", () => {
    const entries = [
      // Decision entry with real agent
      entry({
        timestamp: "2026-04-12T13:00:00Z",
        decision: "allow",
        agentId: "social-manager",
        toolCallId: "tc1",
      }),
      // Result entry without agentId — must NOT create phantom
      entry({
        timestamp: "2026-04-12T13:00:01Z",
        toolCallId: "tc1",
        executionResult: { stdout: "ok" },
      }),
    ];

    const agents = getAgents(entries);
    expect(agents.map((a) => a.id)).not.toContain("default");
    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe("social-manager");
  });

  it("does not create 'default' agent from eval entries without agentId", () => {
    const entries = [
      entry({
        timestamp: "2026-04-12T13:00:00Z",
        decision: "allow",
        agentId: "debugger",
        toolCallId: "tc1",
      }),
      // LLM eval entry without agentId — must NOT create phantom
      entry({
        timestamp: "2026-04-12T13:00:02Z",
        refToolCallId: "tc1",
        llmEvaluation: {
          adjustedScore: 15,
          reasoning: "safe",
          tags: [],
          confidence: "high",
          patterns: [],
        },
      }),
    ];

    const agents = getAgents(entries);
    expect(agents.map((a) => a.id)).not.toContain("default");
    expect(agents).toHaveLength(1);
  });

  it("still falls back to DEFAULT_AGENT_ID for decision entries without agentId", () => {
    const entries = [
      entry({
        timestamp: "2026-04-12T13:00:00Z",
        decision: "allow",
        // no agentId — decision entry, so fallback is correct
      }),
    ];

    const agents = getAgents(entries);
    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe(DEFAULT_AGENT_ID);
    expect(agents[0].todayToolCalls).toBe(1);
  });

  it("ignores result entries even when they have an agentId", () => {
    const entries = [
      entry({
        timestamp: "2026-04-12T13:00:00Z",
        decision: "allow",
        agentId: "social-manager",
        toolCallId: "tc1",
      }),
      // Result with agentId but no decision — should not inflate count
      entry({
        timestamp: "2026-04-12T13:00:01Z",
        agentId: "social-manager",
        toolCallId: "tc1",
        executionResult: { stdout: "done" },
      }),
    ];

    const agents = getAgents(entries);
    expect(agents).toHaveLength(1);
    expect(agents[0].todayToolCalls).toBe(1);
  });

  it("does not create phantom on past-day view", () => {
    const entries = [
      entry({
        timestamp: "2026-04-10T10:00:00Z",
        decision: "allow",
        agentId: "social-manager",
      }),
      // Result entry on same day without agentId
      entry({
        timestamp: "2026-04-10T10:00:01Z",
        executionResult: { stdout: "ok" },
      }),
    ];

    const agents = getAgents(entries, "2026-04-10");
    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe("social-manager");
    expect(agents.map((a) => a.id)).not.toContain("default");
  });

  it("returns empty list when only non-decision entries exist", () => {
    const entries = [
      entry({
        timestamp: "2026-04-12T13:00:00Z",
        executionResult: { stdout: "ok" },
      }),
      entry({
        timestamp: "2026-04-12T13:00:01Z",
        refToolCallId: "tc1",
        llmEvaluation: {
          adjustedScore: 10,
          reasoning: "safe",
          tags: [],
          confidence: "high",
          patterns: [],
        },
      }),
    ];

    const agents = getAgents(entries);
    expect(agents).toHaveLength(0);
  });

  it("risk scores still work via evalIdx despite eval entries excluded from agent map", () => {
    const entries = [
      entry({
        timestamp: "2026-04-12T13:00:00Z",
        decision: "allow",
        agentId: "debugger",
        toolCallId: "tc1",
        riskScore: 40,
      }),
      // Eval adjusts score to 25 — not in agent map but accessible via evalIdx
      entry({
        timestamp: "2026-04-12T13:00:02Z",
        refToolCallId: "tc1",
        llmEvaluation: {
          adjustedScore: 25,
          reasoning: "safe",
          tags: [],
          confidence: "high",
          patterns: [],
        },
      }),
    ];

    const agents = getAgents(entries);
    expect(agents).toHaveLength(1);
    // avgRiskScore should use the LLM-adjusted score (25), not the original (40)
    expect(agents[0].avgRiskScore).toBe(25);
  });
});
