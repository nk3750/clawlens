import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getSessionSummary,
  clearSummaryCache,
  getSummaryCacheSize,
} from "../src/dashboard/session-summary";
import type { AuditEntry } from "../src/audit/logger";

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

describe("getSessionSummary", () => {
  beforeEach(() => {
    clearSummaryCache();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-29T14:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null for unknown session", async () => {
    const entries = [
      entry({ sessionKey: "s1", decision: "allow", timestamp: "2026-03-29T10:00:00Z" }),
    ];
    const result = await getSessionSummary("nonexistent", entries, {
      llmModel: "claude-haiku-4-5-20251001",
      llmApiKeyEnv: "ANTHROPIC_API_KEY",
    });
    expect(result).toBeNull();
  });

  it("generates template summary for <3 entries", async () => {
    const entries = [
      entry({
        sessionKey: "s1",
        decision: "allow",
        toolName: "exec",
        riskScore: 30,
        timestamp: "2026-03-29T10:00:00Z",
      }),
      entry({
        sessionKey: "s1",
        decision: "allow",
        toolName: "read",
        riskScore: 10,
        timestamp: "2026-03-29T10:01:00Z",
      }),
    ];

    const result = await getSessionSummary("s1", entries, {
      llmModel: "claude-haiku-4-5-20251001",
      llmApiKeyEnv: "ANTHROPIC_API_KEY",
    });
    expect(result).not.toBeNull();
    expect(result!.sessionKey).toBe("s1");
    expect(result!.summary).toMatch(/Ran \d+ .+ action/);
    expect(result!.summary).toMatch(/Avg risk: \d+/);
    expect(result!.generatedAt).toBeDefined();
  });

  it("caches results and returns cached on second call", async () => {
    const entries = [
      entry({
        sessionKey: "s1",
        decision: "allow",
        toolName: "exec",
        riskScore: 10,
        timestamp: "2026-03-29T10:00:00Z",
      }),
    ];

    const config = {
      llmModel: "claude-haiku-4-5-20251001",
      llmApiKeyEnv: "ANTHROPIC_API_KEY",
    };

    const first = await getSessionSummary("s1", entries, config);
    expect(getSummaryCacheSize()).toBe(1);

    const second = await getSessionSummary("s1", entries, config);
    expect(second).toEqual(first);
  });

  it("template summary uses dominant category", async () => {
    const entries = [
      entry({
        sessionKey: "s1",
        decision: "allow",
        toolName: "read",
        riskScore: 5,
        timestamp: "2026-03-29T10:00:00Z",
      }),
      entry({
        sessionKey: "s1",
        decision: "allow",
        toolName: "read",
        riskScore: 10,
        timestamp: "2026-03-29T10:01:00Z",
      }),
    ];

    const result = await getSessionSummary("s1", entries, {
      llmModel: "claude-haiku-4-5-20251001",
      llmApiKeyEnv: "ANTHROPIC_API_KEY",
    });
    expect(result!.summary).toContain("exploration");
  });

  it("falls back to template when no API key", async () => {
    // 3+ entries would try LLM, but no key → falls back to template
    const entries = Array.from({ length: 5 }, (_, i) =>
      entry({
        sessionKey: "s1",
        decision: "allow",
        toolName: "exec",
        riskScore: 20,
        timestamp: `2026-03-29T10:${String(i).padStart(2, "0")}:00Z`,
      }),
    );

    // Ensure no API key is set
    const original = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    const result = await getSessionSummary("s1", entries, {
      llmModel: "claude-haiku-4-5-20251001",
      llmApiKeyEnv: "ANTHROPIC_API_KEY",
    });
    expect(result).not.toBeNull();
    expect(result!.summary).toMatch(/Ran \d+ command action/);

    // Restore
    if (original !== undefined) {
      process.env.ANTHROPIC_API_KEY = original;
    }
  });

  it("clearSummaryCache clears all entries", async () => {
    const entries = [
      entry({
        sessionKey: "s1",
        decision: "allow",
        toolName: "exec",
        riskScore: 10,
        timestamp: "2026-03-29T10:00:00Z",
      }),
    ];

    await getSessionSummary("s1", entries, {
      llmModel: "claude-haiku-4-5-20251001",
      llmApiKeyEnv: "ANTHROPIC_API_KEY",
    });
    expect(getSummaryCacheSize()).toBe(1);

    clearSummaryCache();
    expect(getSummaryCacheSize()).toBe(0);
  });
});
