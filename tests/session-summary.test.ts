import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditEntry } from "../src/audit/logger";
import {
  clearSummaryCache,
  getSessionSummary,
  getSummaryCacheSize,
} from "../src/dashboard/session-summary";

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

  it("returns { ok: false, reason: 'not_found' } for unknown session", async () => {
    const entries = [
      entry({ sessionKey: "s1", decision: "allow", timestamp: "2026-03-29T10:00:00Z" }),
    ];
    const result = await getSessionSummary("nonexistent", entries, {
      llmModel: "claude-haiku-4-5-20251001",
      llmApiKeyEnv: "ANTHROPIC_API_KEY",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("not_found");
      expect(result.message).toContain("nonexistent");
    }
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
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.summary.sessionKey).toBe("s1");
      expect(result.summary.summary).toMatch(/Ran \d+ action/);
      expect(result.summary.summary).toMatch(/Avg risk: \d+/);
      expect(result.summary.generatedAt).toBeDefined();
    }
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

  it("template summary uses generic action count (no category label)", async () => {
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
    // Template now says "Ran N actions" — matches stat strip format
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.summary.summary).toMatch(/Ran 2 action/);
      expect(result.summary.summary).toMatch(/Avg risk: \d+/);
    }
  });

  it("falls back to template when no API key and no modelAuth", async () => {
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
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.summary.summary).toMatch(/Ran \d+ action/);
    }

    // Restore
    if (original !== undefined) {
      process.env.ANTHROPIC_API_KEY = original;
    }
  });

  it("attempts modelAuth before env var for summary generation", async () => {
    // modelAuth rejects, no env var → should still fall back to template
    const entries = Array.from({ length: 5 }, (_, i) =>
      entry({
        sessionKey: "s1",
        decision: "allow",
        toolName: "exec",
        riskScore: 20,
        timestamp: `2026-03-29T10:${String(i).padStart(2, "0")}:00Z`,
      }),
    );

    const original = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    const modelAuth = {
      resolveApiKeyForProvider: vi.fn().mockRejectedValue(new Error("Not resolved")),
      getApiKeyForModel: vi.fn().mockRejectedValue(new Error("Not resolved")),
    };

    const result = await getSessionSummary("s1", entries, {
      llmModel: "claude-haiku-4-5-20251001",
      llmApiKeyEnv: "ANTHROPIC_API_KEY",
      modelAuth,
      provider: "anthropic",
    });

    // modelAuth was attempted
    expect(modelAuth.resolveApiKeyForProvider).toHaveBeenCalledWith({
      provider: "anthropic",
      cfg: undefined,
    });
    // Falls back to template
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.summary.summary).toMatch(/Ran \d+ action/);
    }

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

// agent-card-polish §3: card slot is 2 lines × ~70 chars. The prompt asks the
// LLM for ≤140 chars; the server-side cap is the safety net for overshoot.
// These tests pin the cap behavior + the persona/length framing in the prompt
// so future drift surfaces in CI.
describe("getSessionSummary — LLM length cap (agent-card-polish §3)", () => {
  function manyEntries(): AuditEntry[] {
    return Array.from({ length: 5 }, (_, i) =>
      entry({
        sessionKey: "s1",
        decision: "allow",
        toolName: "exec",
        riskScore: 20,
        timestamp: `2026-03-29T10:${String(i).padStart(2, "0")}:00Z`,
      }),
    );
  }

  let originalKey: string | undefined;
  let mockFetch: ReturnType<typeof vi.fn>;
  // Captured user message from the most recent fetch call. Use this to assert
  // the prompt's persona/length framing instead of patching internals.
  let lastUserMessage = "";
  let lastMaxTokens: number | undefined;

  beforeEach(() => {
    clearSummaryCache();
    originalKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "test-key";

    lastUserMessage = "";
    lastMaxTokens = undefined;
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalKey;
    }
    vi.unstubAllGlobals();
  });

  function setLlmResponse(text: string): void {
    mockFetch.mockImplementation(async (_url: string, opts: { body: string }) => {
      const body = JSON.parse(opts.body);
      lastUserMessage = body.messages?.[0]?.content ?? "";
      lastMaxTokens = body.max_tokens;
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ content: [{ type: "text", text }] }),
      } as Response;
    });
  }

  it("truncates a 200-char overshoot at a word boundary and ends with `…`", async () => {
    // 200-char single-line response (well past the 140 limit). The cap should
    // trim to ≤141 chars total (140 + ellipsis), break on a space, and end on
    // a non-space char before the ellipsis.
    const overshoot =
      "This agent has been actively triaging customer support requests across telephony and email channels, escalating two high-risk billing disputes and quietly resolving routine refunds";
    expect(overshoot.length).toBeGreaterThan(160);
    setLlmResponse(overshoot);

    const result = await getSessionSummary("s1", manyEntries(), {
      llmModel: "claude-haiku-4-5-20251001",
      llmApiKeyEnv: "ANTHROPIC_API_KEY",
      provider: "anthropic",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const out = result.summary.summary;
    expect(out.length).toBeLessThanOrEqual(141);
    // Must end on a non-whitespace char immediately before the ellipsis (word
    // boundary, not mid-word).
    expect(out).toMatch(/[^\s]…$/);
  });

  it("passes through a 90-char response untouched (no `…` appended)", async () => {
    const short =
      "This agent is running scheduled health checks across the production search pipelines.";
    expect(short.length).toBeLessThan(140);
    setLlmResponse(short);

    const result = await getSessionSummary("s1", manyEntries(), {
      llmModel: "claude-haiku-4-5-20251001",
      llmApiKeyEnv: "ANTHROPIC_API_KEY",
      provider: "anthropic",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.summary).toBe(short);
    expect(result.summary.summary).not.toMatch(/…$/);
  });

  it("sends `one present-tense sentence` and `140 characters` framing in the prompt", async () => {
    // Locks the persona/cap framing against drift — the card slot exists
    // because of these phrases. If a future PR softens them, this fails.
    setLlmResponse("ok");

    await getSessionSummary("s1", manyEntries(), {
      llmModel: "claude-haiku-4-5-20251001",
      llmApiKeyEnv: "ANTHROPIC_API_KEY",
      provider: "anthropic",
    });

    expect(lastUserMessage).toContain("one present-tense sentence");
    expect(lastUserMessage).toContain("140 characters");
  });

  it("requests max_tokens=48 on the direct-API call (~140 chars + margin)", async () => {
    // Explicit cap on the upstream side. Spec §3 lowers this from the eval
    // path's default (512) so the model can't ramble even before the helper
    // truncates.
    setLlmResponse("ok");

    await getSessionSummary("s1", manyEntries(), {
      llmModel: "claude-haiku-4-5-20251001",
      llmApiKeyEnv: "ANTHROPIC_API_KEY",
      provider: "anthropic",
    });

    expect(lastMaxTokens).toBe(48);
  });
});
