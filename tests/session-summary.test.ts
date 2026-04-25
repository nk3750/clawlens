import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditEntry } from "../src/audit/logger";
import {
  capSummaryLength,
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

// #25: capSummaryLength is content-shaped (sentence-terminator preferred) with
// a 400-char panic stop. Direct unit tests on the helper lock the new shape;
// the LLM-integration tests below pin the soft prompt + token-headroom changes
// that motivated the rewrite.
describe("capSummaryLength", () => {
  it("returns full raw when input ends in a sentence terminator (≥40 chars)", () => {
    // Last terminator is at the very end → slice up to and including it gives
    // the full string. Most common LLM-output shape post-fix.
    const input = "Agent monitors remote host with heartbeat probes.";
    expect(input.length).toBeGreaterThanOrEqual(40);
    expect(capSummaryLength(input)).toBe(input);
  });

  it("returns full raw for multi-sentence input under the panic cap", () => {
    // Last terminator dominates → full string returned. Hybrid display in the
    // popover scrolls if needed; no truncation here.
    const input = "Sentence one ends here. Then a second clean sentence follows.";
    expect(input.length).toBeGreaterThanOrEqual(40);
    expect(input.length).toBeLessThan(400);
    expect(capSummaryLength(input)).toBe(input);
  });

  it("caps at the last terminator that yields ≥40 chars when raw runs past the panic budget", () => {
    // Long tail with no further terminators forces a content-shaped cap at the
    // last `.` in the leading prose. Ellipsis is NOT appended — the sentence
    // terminator already signals completion.
    const head = "First. This is the second sentence here.";
    expect(head.length).toBeGreaterThanOrEqual(40);
    const input = `${head} ${"x".repeat(500)}`;
    expect(capSummaryLength(input)).toBe(head);
    expect(capSummaryLength(input)).not.toMatch(/…$/);
  });

  it("returns full raw for short input ending in '.' (no leading-fragment truncation, no '…')", () => {
    // The 40-char fragment guard exists to avoid truncating 'Yes. Done — agent
    // monitors X' to just 'Yes.'. For inputs already <40 chars, both branches
    // return raw unchanged.
    const input = "Yes. Done.";
    expect(input.length).toBeLessThan(40);
    expect(capSummaryLength(input)).toBe(input);
  });

  it("does NOT truncate to a leading <40-char fragment when the only terminator is too early", () => {
    // 'Yes.' produces a 4-char slice → guard rejects it. Falls through to
    // passthrough since raw (under 400) is below the panic cap.
    const input =
      "Yes. The agent is currently monitoring remote hosts and emitting heartbeat traffic";
    expect(input.length).toBeLessThan(400);
    expect(capSummaryLength(input)).toBe(input);
    expect(capSummaryLength(input)).not.toMatch(/^Yes\.$/);
  });

  it("falls back to word-boundary char-cap with '…' when no terminator AND raw exceeds 400", () => {
    // True LLM misbehavior — long stream of words with no terminators. Last
    // resort: the legacy word-boundary slice plus the '…' marker so the user
    // sees the truncation explicitly.
    const word = "lorem ";
    const input = word.repeat(80).trimEnd(); // 479 chars, spaces, no terminators
    expect(input.length).toBeGreaterThan(400);
    expect(input).not.toMatch(/[.!?]/);
    const out = capSummaryLength(input);
    expect(out).toMatch(/…$/);
    expect(out.length).toBeLessThanOrEqual(401);
  });
});

// LLM-integration tests: stub fetch so we can assert the system prompt + user
// prompt content + max_tokens that the summary path sends upstream. These pin
// the soft-target wording + 100-token headroom from #25 so a regression back
// to "MAXIMUM 140 characters" / 48 tokens fails CI.
describe("getSessionSummary — LLM prompt + token shape (#25)", () => {
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
  let lastUserMessage = "";
  let lastSystemPrompt = "";
  let lastMaxTokens: number | undefined;

  beforeEach(() => {
    clearSummaryCache();
    originalKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "test-key";

    lastUserMessage = "";
    lastSystemPrompt = "";
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
      lastSystemPrompt = body.system ?? "";
      lastMaxTokens = body.max_tokens;
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ content: [{ type: "text", text }] }),
      } as Response;
    });
  }

  it("passes a sentence-terminated LLM response straight through (no '…' appended)", async () => {
    const clean =
      "This agent is running scheduled health checks across the production search pipelines.";
    setLlmResponse(clean);

    const result = await getSessionSummary("s1", manyEntries(), {
      llmModel: "claude-haiku-4-5-20251001",
      llmApiKeyEnv: "ANTHROPIC_API_KEY",
      provider: "anthropic",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.summary).toBe(clean);
    expect(result.summary.summary).not.toMatch(/…$/);
  });

  it("uses a soft length target in the system prompt — no MAXIMUM 140 hard-cap language", async () => {
    // Locks the #25 fix: "MAXIMUM 140 characters" is what caused the popover to
    // land mid-thought. The new framing prefers a complete sentence over a hard
    // count.
    setLlmResponse("ok");

    await getSessionSummary("s1", manyEntries(), {
      llmModel: "claude-haiku-4-5-20251001",
      llmApiKeyEnv: "ANTHROPIC_API_KEY",
      provider: "anthropic",
    });

    expect(lastSystemPrompt).toContain("complete thought");
    expect(lastSystemPrompt).toContain("200 characters");
    expect(lastSystemPrompt).not.toMatch(/MAXIMUM\s+140/);
    // User-side persona framing is preserved.
    expect(lastUserMessage).toContain("one present-tense sentence");
  });

  it("requests max_tokens=100 on the direct-API call (room for a long-but-complete sentence)", async () => {
    // Bumped from 48 → 100 in #25 so the LLM has headroom to land on a sentence
    // terminator instead of truncating mid-word against the upstream cap.
    setLlmResponse("ok");

    await getSessionSummary("s1", manyEntries(), {
      llmModel: "claude-haiku-4-5-20251001",
      llmApiKeyEnv: "ANTHROPIC_API_KEY",
      provider: "anthropic",
    });

    expect(lastMaxTokens).toBe(100);
  });
});
