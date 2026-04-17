import { describe, expect, it } from "vitest";
import type { AuditEntry } from "../src/audit/logger";
import { dedupeAuditEntries } from "../src/audit/reader";

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    timestamp: "2026-04-16T19:01:15.774Z",
    toolName: "exec",
    toolCallId: "tool_abc",
    params: { command: "ls" },
    decision: "allow",
    riskScore: 20,
    riskTier: "low",
    agentId: "debugger",
    sessionKey: "agent:debugger:cron:health-and-errors-016",
    prevHash: "0",
    hash: "h",
    ...overrides,
  };
}

describe("dedupeAuditEntries", () => {
  it("collapses 7 identical-timestamp decision entries to 1", () => {
    const entries = Array.from({ length: 7 }, () => entry());
    const result = dedupeAuditEntries(entries);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(entries[0]);
  });

  it("preserves decision + result + eval for the same tool call", () => {
    const entries: AuditEntry[] = [
      entry({ decision: "allow" }),
      entry({
        decision: undefined,
        executionResult: "success",
        timestamp: "2026-04-16T19:01:16.100Z",
      }),
      entry({
        decision: undefined,
        llmEvaluation: {
          adjustedScore: 30,
          reasoning: "ok",
          tags: [],
          confidence: "low",
          patterns: [],
        },
        timestamp: "2026-04-16T19:01:17.000Z",
      }),
    ];
    const result = dedupeAuditEntries(entries);
    expect(result).toHaveLength(3);
  });

  it("keeps distinct tool calls with the same timestamp", () => {
    const entries: AuditEntry[] = [
      entry({ toolCallId: "tool_a" }),
      entry({ toolCallId: "tool_b" }),
      entry({ toolCallId: "tool_a" }), // dupe of first
    ];
    const result = dedupeAuditEntries(entries);
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.toolCallId)).toEqual(["tool_a", "tool_b"]);
  });

  it("preserves input order for kept entries", () => {
    const a = entry({ toolCallId: "a", timestamp: "2026-04-16T10:00:00.000Z" });
    const b = entry({ toolCallId: "b", timestamp: "2026-04-16T10:00:01.000Z" });
    const c = entry({ toolCallId: "c", timestamp: "2026-04-16T10:00:02.000Z" });
    const result = dedupeAuditEntries([a, a, b, a, c, b]);
    expect(result.map((e) => e.toolCallId)).toEqual(["a", "b", "c"]);
  });

  it("handles entries with no toolCallId", () => {
    const entries: AuditEntry[] = [
      entry({ toolCallId: undefined, timestamp: "2026-04-16T10:00:00.000Z" }),
      entry({ toolCallId: undefined, timestamp: "2026-04-16T10:00:00.000Z" }),
      entry({ toolCallId: undefined, timestamp: "2026-04-16T10:00:01.000Z" }),
    ];
    const result = dedupeAuditEntries(entries);
    expect(result).toHaveLength(2);
  });

  it("returns empty array unchanged", () => {
    expect(dedupeAuditEntries([])).toEqual([]);
  });
});
