import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditEntry } from "../src/audit/logger";
import {
  capSummaryLength,
  clearSummaryCache,
  getSessionSummary,
  getSummaryCacheSize,
  SUMMARY_LLM_DISABLED_MESSAGE,
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
      llmEnabled: true,
      llmModel: "claude-haiku-4-5-20251001",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("not_found");
      expect(result.message).toContain("nonexistent");
    }
  });

  it("generates template summary for <3 entries when LLM enabled", async () => {
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
      llmEnabled: true,
      llmModel: "claude-haiku-4-5-20251001",
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
      llmEnabled: true,
      llmModel: "claude-haiku-4-5-20251001",
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
      llmEnabled: true,
      llmModel: "claude-haiku-4-5-20251001",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.summary.summary).toMatch(/Ran 2 action/);
      expect(result.summary.summary).toMatch(/Avg risk: \d+/);
    }
  });

  it("falls back to template when LLM enabled but no modelAuth and no agent", async () => {
    // 3+ entries would try LLM, but no modelAuth/agent → falls back to template
    const entries = Array.from({ length: 5 }, (_, i) =>
      entry({
        sessionKey: "s1",
        decision: "allow",
        toolName: "exec",
        riskScore: 20,
        timestamp: `2026-03-29T10:${String(i).padStart(2, "0")}:00Z`,
      }),
    );

    const result = await getSessionSummary("s1", entries, {
      llmEnabled: true,
      llmModel: "claude-haiku-4-5-20251001",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.summary.summary).toMatch(/Ran \d+ action/);
    }
  });

  it("attempts modelAuth before falling back to template (no env-var fallback)", async () => {
    const entries = Array.from({ length: 5 }, (_, i) =>
      entry({
        sessionKey: "s1",
        decision: "allow",
        toolName: "exec",
        riskScore: 20,
        timestamp: `2026-03-29T10:${String(i).padStart(2, "0")}:00Z`,
      }),
    );

    // Even with an env key set, summary generation must not use it.
    const original = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "should-not-be-used";

    const modelAuth = {
      resolveApiKeyForProvider: vi.fn().mockRejectedValue(new Error("Not resolved")),
      getApiKeyForModel: vi.fn().mockRejectedValue(new Error("Not resolved")),
    };

    const result = await getSessionSummary("s1", entries, {
      llmEnabled: true,
      llmModel: "claude-haiku-4-5-20251001",
      modelAuth,
      provider: "anthropic",
    });

    expect(modelAuth.resolveApiKeyForProvider).toHaveBeenCalledWith({
      provider: "anthropic",
      cfg: undefined,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.summary.summary).toMatch(/Ran \d+ action/);
    }

    if (original !== undefined) {
      process.env.ANTHROPIC_API_KEY = original;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
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
      llmEnabled: true,
      llmModel: "claude-haiku-4-5-20251001",
    });
    expect(getSummaryCacheSize()).toBe(1);

    clearSummaryCache();
    expect(getSummaryCacheSize()).toBe(0);
  });
});

describe("getSessionSummary — risk.llmEnabled=false gate (v1.0.1)", () => {
  beforeEach(() => {
    clearSummaryCache();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-29T14:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the disabled-message summary when llmEnabled is false (3+ entries)", async () => {
    const entries = Array.from({ length: 5 }, (_, i) =>
      entry({
        sessionKey: "s1",
        decision: "allow",
        toolName: "exec",
        riskScore: 20,
        timestamp: `2026-03-29T10:${String(i).padStart(2, "0")}:00Z`,
      }),
    );

    const result = await getSessionSummary("s1", entries, {
      llmEnabled: false,
      llmModel: "claude-haiku-4-5-20251001",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.summary).toBe(SUMMARY_LLM_DISABLED_MESSAGE);
    expect(result.summary.isLlmGenerated).toBe(false);
  });

  it("never calls modelAuth or fetch when llmEnabled=false", async () => {
    const entries = Array.from({ length: 5 }, (_, i) =>
      entry({
        sessionKey: "s1",
        decision: "allow",
        toolName: "exec",
        riskScore: 20,
        timestamp: `2026-03-29T10:${String(i).padStart(2, "0")}:00Z`,
      }),
    );

    const modelAuth = {
      resolveApiKeyForProvider: vi.fn().mockResolvedValue({
        apiKey: "real-key",
        source: "test",
        mode: "api-key" as const,
      }),
    };

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    try {
      await getSessionSummary("s1", entries, {
        llmEnabled: false,
        llmModel: "claude-haiku-4-5-20251001",
        modelAuth,
        provider: "anthropic",
      });

      expect(modelAuth.resolveApiKeyForProvider).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("references the exact config key in the disabled message", () => {
    // Lock the spec wording §8 L716-720 verbatim so future copy drifts are
    // caught by the test suite.
    expect(SUMMARY_LLM_DISABLED_MESSAGE).toContain("risk.llmEnabled");
    expect(SUMMARY_LLM_DISABLED_MESSAGE).toContain("plugins.entries.clawlens.config");
  });
});

// #25: capSummaryLength is content-shaped (sentence-terminator preferred) with
// a 400-char panic stop.
describe("capSummaryLength", () => {
  it("returns full raw when input ends in a sentence terminator (≥40 chars)", () => {
    const input = "Agent monitors remote host with heartbeat probes.";
    expect(input.length).toBeGreaterThanOrEqual(40);
    expect(capSummaryLength(input)).toBe(input);
  });

  it("returns full raw for multi-sentence input under the panic cap", () => {
    const input = "Sentence one ends here. Then a second clean sentence follows.";
    expect(input.length).toBeGreaterThanOrEqual(40);
    expect(input.length).toBeLessThan(400);
    expect(capSummaryLength(input)).toBe(input);
  });

  it("caps at the last terminator that yields ≥40 chars when raw runs past the panic budget", () => {
    const head = "First. This is the second sentence here.";
    expect(head.length).toBeGreaterThanOrEqual(40);
    const input = `${head} ${"x".repeat(500)}`;
    expect(capSummaryLength(input)).toBe(head);
    expect(capSummaryLength(input)).not.toMatch(/…$/);
  });

  it("returns full raw for short input ending in '.' (no leading-fragment truncation, no '…')", () => {
    const input = "Yes. Done.";
    expect(input.length).toBeLessThan(40);
    expect(capSummaryLength(input)).toBe(input);
  });

  it("does NOT truncate to a leading <40-char fragment when the only terminator is too early", () => {
    const input =
      "Yes. The agent is currently monitoring remote hosts and emitting heartbeat traffic";
    expect(input.length).toBeLessThan(400);
    expect(capSummaryLength(input)).toBe(input);
    expect(capSummaryLength(input)).not.toMatch(/^Yes\.$/);
  });

  it("falls back to word-boundary char-cap with '…' when no terminator AND raw exceeds 400", () => {
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
// prompt content + max_tokens that the summary path sends upstream when
// llmEnabled=true + modelAuth resolves a key.
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

  let mockFetch: ReturnType<typeof vi.fn>;
  let lastUserMessage = "";
  let lastSystemPrompt = "";
  let lastMaxTokens: number | undefined;

  function modelAuthOk(key: string) {
    return {
      resolveApiKeyForProvider: vi.fn().mockResolvedValue({
        apiKey: key,
        source: "test",
        mode: "api-key" as const,
      }),
    };
  }

  beforeEach(() => {
    clearSummaryCache();

    lastUserMessage = "";
    lastSystemPrompt = "";
    lastMaxTokens = undefined;
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
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
      llmEnabled: true,
      llmModel: "claude-haiku-4-5-20251001",
      provider: "anthropic",
      modelAuth: modelAuthOk("test-key"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.summary).toBe(clean);
    expect(result.summary.summary).not.toMatch(/…$/);
  });

  it("uses a soft length target in the system prompt — no MAXIMUM 140 hard-cap language", async () => {
    setLlmResponse("ok");

    await getSessionSummary("s1", manyEntries(), {
      llmEnabled: true,
      llmModel: "claude-haiku-4-5-20251001",
      provider: "anthropic",
      modelAuth: modelAuthOk("test-key"),
    });

    expect(lastSystemPrompt).toContain("complete thought");
    expect(lastSystemPrompt).toContain("200 characters");
    expect(lastSystemPrompt).not.toMatch(/MAXIMUM\s+140/);
    expect(lastUserMessage).toContain("one present-tense sentence");
  });

  it("requests max_tokens=100 on the direct-API call (room for a long-but-complete sentence)", async () => {
    setLlmResponse("ok");

    await getSessionSummary("s1", manyEntries(), {
      llmEnabled: true,
      llmModel: "claude-haiku-4-5-20251001",
      provider: "anthropic",
      modelAuth: modelAuthOk("test-key"),
    });

    expect(lastMaxTokens).toBe(100);
  });
});

// Spec §1 L180: opt-in LLM evaluation must use OpenClaw's current configured
// provider/model through OpenClaw's runtime. Hardcoding a model name in the
// route layer breaks non-Anthropic setups (e.g. provider=openai gets sent a
// Claude model name and the upstream API rejects the request). The model
// should be derived from `DEFAULT_EVAL_MODELS[provider]` when no explicit
// override is configured.
describe("getSessionSummary — provider-aware model defaults", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let lastUrl = "";
  let lastModel: string | undefined;

  function modelAuthOk(key: string) {
    return {
      resolveApiKeyForProvider: vi.fn().mockResolvedValue({
        apiKey: key,
        source: "test",
        mode: "api-key" as const,
      }),
    };
  }

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

  beforeEach(() => {
    clearSummaryCache();
    lastUrl = "";
    lastModel = undefined;
    mockFetch = vi.fn(async (url: string, opts: { body: string }) => {
      lastUrl = url;
      const body = JSON.parse(opts.body);
      lastModel = body.model;
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ choices: [{ message: { content: "ok" } }] }),
      } as Response;
    });
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses gpt-4o-mini when provider=openai and no model override is supplied", async () => {
    // Reproduces the route-layer regression: hardcoding the Anthropic model
    // here would send "claude-haiku-..." to the OpenAI endpoint and fail.
    await getSessionSummary("s1", manyEntries(), {
      llmEnabled: true,
      llmModel: "",
      provider: "openai",
      modelAuth: modelAuthOk("openai-key"),
    });

    expect(lastUrl).toBe("https://api.openai.com/v1/chat/completions");
    expect(lastModel).toBe("gpt-4o-mini");
  });

  it("uses claude-haiku-4-5-20251001 when provider=anthropic and no model override is supplied", async () => {
    // Build a fresh fetch mock for anthropic's response shape.
    mockFetch.mockImplementation(async (url: string, opts: { body: string }) => {
      lastUrl = url;
      const body = JSON.parse(opts.body);
      lastModel = body.model;
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ content: [{ type: "text", text: "ok" }] }),
      } as Response;
    });

    await getSessionSummary("s1", manyEntries(), {
      llmEnabled: true,
      llmModel: "",
      provider: "anthropic",
      modelAuth: modelAuthOk("anth-key"),
    });

    expect(lastUrl).toBe("https://api.anthropic.com/v1/messages");
    expect(lastModel).toBe("claude-haiku-4-5-20251001");
  });
});
