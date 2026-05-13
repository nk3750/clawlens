import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { llmHealthTracker } from "../src/audit/llm-health";
import {
  buildEvalMessage,
  callLlmApi,
  collectEmbeddedText,
  DEFAULT_EVAL_MODELS,
  EVAL_SYSTEM_PROMPT,
  evaluateWithLlm,
  PROVIDER_ENDPOINTS,
  parseEvalResponse,
  resolveModel,
} from "../src/risk/llm-evaluator";
import type { RiskScore } from "../src/risk/types";

// ── Helpers ──────────────────────────────────────────────

function tier1Score(overrides: Partial<RiskScore> = {}): RiskScore {
  return {
    score: 55,
    tier: "medium",
    tags: ["network"],
    breakdown: { base: 50, modifiers: [{ reason: "network", delta: 5 }] },
    needsLlmEval: true,
    ...overrides,
  };
}

const VALID_EVAL_JSON = JSON.stringify({
  adjustedScore: 42,
  reasoning: "Routine health check",
  tags: ["network", "read-only"],
  confidence: "high",
  patterns: [],
});

function mockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function mockModelAuth(key: string) {
  return {
    resolveApiKeyForProvider: vi.fn().mockResolvedValue({
      apiKey: key,
      source: "test",
      mode: "api-key" as const,
    }),
  };
}

function mockModelAuthRejecting(reason: string) {
  return {
    resolveApiKeyForProvider: vi.fn().mockRejectedValue(new Error(reason)),
  };
}

function mockModelAuthNoKey() {
  return {
    resolveApiKeyForProvider: vi.fn().mockResolvedValue({
      apiKey: undefined,
      source: "test",
      mode: "api-key" as const,
    }),
  };
}

function mockEmbeddedAgent(responseText: string) {
  return {
    runEmbeddedPiAgent: vi.fn().mockResolvedValue({
      payloads: [{ text: responseText, isError: false }],
      meta: { durationMs: 500 },
    }),
  };
}

function mockEmbeddedAgentError(errorMsg: string) {
  return {
    runEmbeddedPiAgent: vi.fn().mockRejectedValue(new Error(errorMsg)),
  };
}

function mockEmbeddedAgentEmpty() {
  return {
    runEmbeddedPiAgent: vi.fn().mockResolvedValue({
      payloads: [],
      meta: { durationMs: 100 },
    }),
  };
}

// ── Mock fetch ───────────────────────────────────────────

const mockFetch = vi.fn();

function setFetchResponse(body: unknown, status = 200) {
  mockFetch.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: () => Promise.resolve(body),
  });
}

function setAnthropicFetchResponse(text: string) {
  setFetchResponse({ content: [{ type: "text", text }] });
}

function setOpenAiFetchResponse(text: string) {
  setFetchResponse({ choices: [{ message: { content: text } }] });
}

// ── Tests ────────────────────────────────────────────────

describe("parseEvalResponse", () => {
  it("parses valid JSON response", () => {
    const result = parseEvalResponse(VALID_EVAL_JSON);
    expect(result).not.toBeNull();
    expect(result!.adjustedScore).toBe(42);
    expect(result!.reasoning).toBe("Routine health check");
    expect(result!.tags).toEqual(["network", "read-only"]);
    expect(result!.confidence).toBe("high");
  });

  it("extracts JSON from markdown code blocks", () => {
    const wrapped = `\`\`\`json\n${VALID_EVAL_JSON}\n\`\`\``;
    const result = parseEvalResponse(wrapped);
    expect(result).not.toBeNull();
    expect(result!.adjustedScore).toBe(42);
  });

  it("clamps adjustedScore to 0-100", () => {
    const high = parseEvalResponse(
      JSON.stringify({
        adjustedScore: 150,
        reasoning: "test",
        tags: [],
        confidence: "low",
        patterns: [],
      }),
    );
    expect(high!.adjustedScore).toBe(100);

    const low = parseEvalResponse(
      JSON.stringify({
        adjustedScore: -10,
        reasoning: "test",
        tags: [],
        confidence: "low",
        patterns: [],
      }),
    );
    expect(low!.adjustedScore).toBe(0);
  });

  it("returns null for non-JSON", () => {
    expect(parseEvalResponse("not json")).toBeNull();
  });

  it("returns null if adjustedScore is missing", () => {
    expect(parseEvalResponse(JSON.stringify({ reasoning: "test" }))).toBeNull();
  });

  it("returns null if reasoning is missing", () => {
    expect(parseEvalResponse(JSON.stringify({ adjustedScore: 50 }))).toBeNull();
  });

  it("defaults confidence to low if invalid", () => {
    const result = parseEvalResponse(
      JSON.stringify({ adjustedScore: 50, reasoning: "test", confidence: "ultra" }),
    );
    expect(result!.confidence).toBe("low");
  });

  it("defaults tags and patterns to empty arrays if not arrays", () => {
    const result = parseEvalResponse(
      JSON.stringify({ adjustedScore: 50, reasoning: "test", tags: "oops", patterns: null }),
    );
    expect(result!.tags).toEqual([]);
    expect(result!.patterns).toEqual([]);
  });
});

describe("collectEmbeddedText", () => {
  it("joins non-error text payloads", () => {
    const payloads = [
      { text: "hello", isError: false },
      { text: " world", isError: false },
    ];
    expect(collectEmbeddedText(payloads)).toBe("hello\n world");
  });

  it("filters out error payloads", () => {
    const payloads = [
      { text: "good", isError: false },
      { text: "bad", isError: true },
    ];
    expect(collectEmbeddedText(payloads)).toBe("good");
  });

  it("returns empty string for undefined payloads", () => {
    expect(collectEmbeddedText(undefined)).toBe("");
  });

  it("returns empty string for empty payloads", () => {
    expect(collectEmbeddedText([])).toBe("");
  });

  it("trims whitespace", () => {
    const payloads = [{ text: "  result  ", isError: false }];
    expect(collectEmbeddedText(payloads)).toBe("result");
  });
});

describe("buildEvalMessage", () => {
  it("produces valid JSON with expected structure", () => {
    const msg = buildEvalMessage(
      "exec",
      { command: "curl https://example.com" },
      [
        {
          toolName: "read",
          params: { path: "/etc/hosts" },
          riskScore: 10,
          timestamp: "2026-04-07T10:00:00Z",
        },
      ],
      tier1Score(),
    );
    const parsed = JSON.parse(msg);
    expect(parsed.currentAction.toolName).toBe("exec");
    expect(parsed.currentAction.params.command).toBe("curl https://example.com");
    expect(parsed.recentActions).toHaveLength(1);
    expect(parsed.preliminaryRiskScore).toBe(55);
    expect(parsed.preliminaryTier).toBe("medium");
    expect(parsed.preliminaryTags).toEqual(["network"]);
  });

  it("handles empty recent actions", () => {
    const msg = buildEvalMessage("read", { path: "/tmp" }, [], tier1Score());
    const parsed = JSON.parse(msg);
    expect(parsed.recentActions).toEqual([]);
  });
});

describe("resolveModel", () => {
  it("returns config model when set", () => {
    expect(resolveModel("anthropic", "custom-model")).toBe("custom-model");
  });

  it("returns default model for known provider", () => {
    expect(resolveModel("anthropic")).toBe("claude-haiku-4-5-20251001");
    expect(resolveModel("openai")).toBe("gpt-4o-mini");
    expect(resolveModel("groq")).toBe("llama-3.1-8b-instant");
    expect(resolveModel("together")).toBe("meta-llama/Llama-3.1-8B-Instruct-Turbo");
  });

  it("returns undefined for unknown provider with no config", () => {
    expect(resolveModel("unknown-provider")).toBeUndefined();
    expect(resolveModel(undefined)).toBeUndefined();
  });

  it("config model takes priority over default", () => {
    expect(resolveModel("anthropic", "my-custom-haiku")).toBe("my-custom-haiku");
  });
});

describe("callLlmApi", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("anthropic: sends correct headers and body format", async () => {
    setAnthropicFetchResponse(VALID_EVAL_JSON);
    await callLlmApi(
      "anthropic",
      "test-key",
      "claude-haiku-4-5-20251001",
      "System prompt",
      "User msg",
    );

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(opts.headers["x-api-key"]).toBe("test-key");
    expect(opts.headers["anthropic-version"]).toBe("2023-06-01");
    expect(opts.headers.Authorization).toBeUndefined();

    const body = JSON.parse(opts.body);
    expect(body.model).toBe("claude-haiku-4-5-20251001");
    expect(body.system).toBe("System prompt");
    expect(body.messages).toEqual([{ role: "user", content: "User msg" }]);
  });

  it("anthropic: extracts text from content blocks", async () => {
    setAnthropicFetchResponse("hello world");
    const result = await callLlmApi("anthropic", "key", "model", "sys", "usr");
    expect(result).toBe("hello world");
  });

  it("openai: sends correct headers and body format", async () => {
    setOpenAiFetchResponse(VALID_EVAL_JSON);
    await callLlmApi("openai", "test-key", "gpt-4o-mini", "System prompt", "User msg");

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(opts.headers.Authorization).toBe("Bearer test-key");
    expect(opts.headers["x-api-key"]).toBeUndefined();

    const body = JSON.parse(opts.body);
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.messages).toEqual([
      { role: "system", content: "System prompt" },
      { role: "user", content: "User msg" },
    ]);
  });

  it("openai: extracts text from choices", async () => {
    setOpenAiFetchResponse("response text");
    const result = await callLlmApi("openai", "key", "model", "sys", "usr");
    expect(result).toBe("response text");
  });

  it("groq: uses openai-compatible format with correct endpoint", async () => {
    setOpenAiFetchResponse("groq response");
    await callLlmApi("groq", "key", "llama-3.1-8b-instant", "sys", "usr");

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
  });

  it("together: uses openai-compatible format with correct endpoint", async () => {
    setOpenAiFetchResponse("together response");
    await callLlmApi("together", "key", "meta-llama/Llama-3.1-8B-Instruct-Turbo", "sys", "usr");

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.together.xyz/v1/chat/completions");
  });

  it("unknown provider: returns null", async () => {
    const logger = mockLogger();
    const result = await callLlmApi("unknown-provider", "key", "model", "sys", "usr", logger);
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Unknown provider"));
  });

  it("returns null on HTTP error", async () => {
    setFetchResponse({ error: "bad request" }, 400);
    const logger = mockLogger();
    const result = await callLlmApi("anthropic", "key", "model", "sys", "usr", logger);
    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("400"));
  });

  it("returns null on fetch error", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));
    const logger = mockLogger();
    const result = await callLlmApi("anthropic", "key", "model", "sys", "usr", logger);
    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Network error"));
  });

  it("returns null on abort (timeout)", async () => {
    mockFetch.mockRejectedValue(new DOMException("The operation was aborted", "AbortError"));
    const logger = mockLogger();
    const result = await callLlmApi("anthropic", "key", "model", "sys", "usr", logger);
    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("timed out"));
  });

  it("returns null when anthropic response has no content", async () => {
    setFetchResponse({ content: [] });
    const result = await callLlmApi("anthropic", "key", "model", "sys", "usr");
    expect(result).toBe("");
  });

  it("returns null when openai response has no choices", async () => {
    setFetchResponse({ choices: [] });
    const result = await callLlmApi("openai", "key", "model", "sys", "usr");
    expect(result).toBeNull();
  });
});

describe("evaluateWithLlm — v1.0.1 local-safe behavior", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
    llmHealthTracker.reset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // ── Path 1: Embedded agent ────────────────────────────

  it("Path 1: embedded agent succeeds → returns parsed eval", async () => {
    const agent = mockEmbeddedAgent(VALID_EVAL_JSON);
    const logger = mockLogger();

    const result = await evaluateWithLlm(
      "exec",
      { command: "curl https://example.com" },
      [],
      tier1Score(),
      { agent },
      logger,
      { provider: "anthropic" },
    );

    expect(result.adjustedScore).toBe(42);
    expect(result.reasoning).toBe("Routine health check");
    expect(agent.runEmbeddedPiAgent).toHaveBeenCalledOnce();
    // No direct provider call follows when the embedded agent already succeeded.
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("Path 1: embedded agent passes config and system prompt", async () => {
    const agent = mockEmbeddedAgent(VALID_EVAL_JSON);
    const cfg = { auth: { profiles: {} } };

    await evaluateWithLlm(
      "exec",
      { command: "test" },
      [],
      tier1Score(),
      { agent },
      undefined,
      { provider: "anthropic" },
      cfg,
    );

    const params = agent.runEmbeddedPiAgent.mock.calls[0][0];
    expect(params.config).toBe(cfg);
    expect(params.extraSystemPrompt).toBe(EVAL_SYSTEM_PROMPT);
    expect(params.disableTools).toBe(true);
    expect(params.provider).toBe("anthropic");
  });

  it("Path 1: embedded agent returns unparseable text → falls through", async () => {
    const agent = mockEmbeddedAgent("not valid json at all");
    setAnthropicFetchResponse(VALID_EVAL_JSON);
    const auth = mockModelAuth("ma-key");
    const logger = mockLogger();

    const result = await evaluateWithLlm(
      "exec",
      { command: "test" },
      [],
      tier1Score(),
      { agent, modelAuth: auth },
      logger,
      { provider: "anthropic" },
    );

    // Should fall through to modelAuth and succeed
    expect(result.adjustedScore).toBe(42);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("unparseable"));
    expect(mockFetch).toHaveBeenCalled();
  });

  it("Path 1: embedded agent returns empty payloads → falls through", async () => {
    const agent = mockEmbeddedAgentEmpty();
    setAnthropicFetchResponse(VALID_EVAL_JSON);
    const auth = mockModelAuth("ma-key");
    const logger = mockLogger();

    const result = await evaluateWithLlm(
      "exec",
      { command: "test" },
      [],
      tier1Score(),
      { agent, modelAuth: auth },
      logger,
      { provider: "anthropic" },
    );

    expect(result.adjustedScore).toBe(42);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("no text"));
  });

  it("Path 1: embedded agent throws → falls through gracefully", async () => {
    const agent = mockEmbeddedAgentError("Agent runtime unavailable");
    setAnthropicFetchResponse(VALID_EVAL_JSON);
    const auth = mockModelAuth("ma-key");
    const logger = mockLogger();

    const result = await evaluateWithLlm(
      "exec",
      { command: "test" },
      [],
      tier1Score(),
      { agent, modelAuth: auth },
      logger,
      { provider: "anthropic" },
    );

    expect(result.adjustedScore).toBe(42);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Agent runtime unavailable"));
  });

  // ── Path 2: modelAuth (the only direct-API path in v1.0.1) ───

  it("Path 2: modelAuth resolves key → direct API succeeds → returns eval", async () => {
    setAnthropicFetchResponse(VALID_EVAL_JSON);
    const auth = mockModelAuth("ma-key-123");
    const logger = mockLogger();

    const result = await evaluateWithLlm(
      "exec",
      { command: "curl https://example.com" },
      [],
      tier1Score(),
      { modelAuth: auth },
      logger,
      { provider: "anthropic" },
      { auth: { profiles: {} } },
    );

    expect(result.adjustedScore).toBe(42);
    expect(result.reasoning).toBe("Routine health check");
    // Verify object param format (not bare string)
    expect(auth.resolveApiKeyForProvider).toHaveBeenCalledWith({
      provider: "anthropic",
      cfg: { auth: { profiles: {} } },
    });
  });

  it("Path 2: uses default model for provider when config model is empty", async () => {
    setAnthropicFetchResponse(VALID_EVAL_JSON);
    const auth = mockModelAuth("key");

    await evaluateWithLlm(
      "exec",
      { command: "test" },
      [],
      tier1Score(),
      { modelAuth: auth },
      undefined,
      { provider: "anthropic" },
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe("claude-haiku-4-5-20251001");
  });

  it("Path 2: openai provider uses openai-compatible format", async () => {
    setOpenAiFetchResponse(VALID_EVAL_JSON);
    const auth = mockModelAuth("key");

    const result = await evaluateWithLlm(
      "exec",
      { command: "test" },
      [],
      tier1Score(),
      { modelAuth: auth },
      undefined,
      { provider: "openai" },
    );

    expect(result.adjustedScore).toBe(42);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(opts.headers.Authorization).toBe("Bearer key");
  });

  // ── Local-safe baseline: no env-key fallback ────────────

  it("modelAuth resolves no apiKey → falls back to stub (no env-var fallback)", async () => {
    const auth = mockModelAuthNoKey();
    const logger = mockLogger();

    // Even if an LLM API-key env var happens to be set, ClawLens must not read it.
    const originalKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "should-not-be-used-env-key";

    try {
      const result = await evaluateWithLlm(
        "exec",
        { command: "test" },
        [],
        tier1Score(),
        { modelAuth: auth },
        logger,
        { provider: "anthropic" },
      );

      expect(result.reasoning).toContain("Stub evaluation");
      expect(mockFetch).not.toHaveBeenCalled();
    } finally {
      if (originalKey !== undefined) {
        process.env.ANTHROPIC_API_KEY = originalKey;
      } else {
        delete process.env.ANTHROPIC_API_KEY;
      }
    }
  });

  it("modelAuth rejects → falls back to stub (no env-var fallback) and records degraded health", async () => {
    const auth = mockModelAuthRejecting("Auth provider not initialized");
    const logger = mockLogger();

    // Sanity: env key would have powered the old Path 3. Must not be read.
    const originalKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "should-not-be-used-env-key";

    try {
      const result = await evaluateWithLlm(
        "exec",
        { command: "test" },
        [],
        tier1Score(),
        { modelAuth: auth },
        logger,
        { provider: "anthropic" },
      );

      expect(result.reasoning).toContain("Stub evaluation");
      expect(mockFetch).not.toHaveBeenCalled();
      // Degraded health is the dashboard's signal — the modelAuth failure must
      // surface as a recorded failure attempt, not a silent fallback.
      const snap = llmHealthTracker.snapshot();
      expect(snap.recentFailures).toBeGreaterThan(0);
    } finally {
      if (originalKey !== undefined) {
        process.env.ANTHROPIC_API_KEY = originalKey;
      } else {
        delete process.env.ANTHROPIC_API_KEY;
      }
    }
  });

  it("no runtime → returns stub (does not read env vars)", async () => {
    const logger = mockLogger();

    const originalKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "should-not-be-used-env-key";

    try {
      const result = await evaluateWithLlm(
        "exec",
        { command: "test" },
        [],
        tier1Score(),
        undefined,
        logger,
        {},
      );

      expect(result.adjustedScore).toBe(55);
      expect(result.reasoning).toContain("Stub evaluation");
      expect(mockFetch).not.toHaveBeenCalled();
    } finally {
      if (originalKey !== undefined) {
        process.env.ANTHROPIC_API_KEY = originalKey;
      } else {
        delete process.env.ANTHROPIC_API_KEY;
      }
    }
  });

  it("skips modelAuth when no provider is set → stub (no env fallback)", async () => {
    const auth = mockModelAuth("key");
    const logger = mockLogger();

    const originalKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "should-not-be-used-env-key";

    try {
      const result = await evaluateWithLlm(
        "exec",
        { command: "test" },
        [],
        tier1Score(),
        { modelAuth: auth },
        logger,
        {},
      );

      expect(auth.resolveApiKeyForProvider).not.toHaveBeenCalled();
      expect(result.reasoning).toContain("Stub evaluation");
      expect(mockFetch).not.toHaveBeenCalled();
    } finally {
      if (originalKey !== undefined) {
        process.env.ANTHROPIC_API_KEY = originalKey;
      } else {
        delete process.env.ANTHROPIC_API_KEY;
      }
    }
  });

  it("unknown provider → skips modelAuth, falls through to stub", async () => {
    const auth = mockModelAuth("key");
    const logger = mockLogger();

    const result = await evaluateWithLlm(
      "exec",
      { command: "test" },
      [],
      tier1Score(),
      { modelAuth: auth },
      logger,
      { provider: "custom-llm" },
    );

    // modelAuth skipped because provider has no endpoint
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.reasoning).toContain("Stub evaluation");
  });

  it("returns stub.tags from the tier-1 score when all eval paths fail", async () => {
    const auth = mockModelAuthRejecting("Not resolved");
    const logger = mockLogger();

    const result = await evaluateWithLlm(
      "exec",
      { command: "test" },
      [],
      tier1Score({ score: 55, tags: ["network"] }),
      { modelAuth: auth },
      logger,
      { provider: "anthropic" },
    );

    expect(result.adjustedScore).toBe(55);
    expect(result.reasoning).toContain("Stub evaluation");
    expect(result.confidence).toBe("low");
    expect(result.tags).toEqual(["network"]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("All eval paths exhausted"));
  });
});

describe("PROVIDER_ENDPOINTS", () => {
  it("has entries for all known providers", () => {
    expect(PROVIDER_ENDPOINTS.anthropic).toBeDefined();
    expect(PROVIDER_ENDPOINTS.openai).toBeDefined();
    expect(PROVIDER_ENDPOINTS.groq).toBeDefined();
    expect(PROVIDER_ENDPOINTS.together).toBeDefined();
  });
});

describe("DEFAULT_EVAL_MODELS", () => {
  it("has a default model for each known provider", () => {
    for (const provider of Object.keys(PROVIDER_ENDPOINTS)) {
      expect(DEFAULT_EVAL_MODELS[provider]).toBeDefined();
    }
  });
});
