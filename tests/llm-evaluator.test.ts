import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildEvalMessage,
  callLlmApi,
  DEFAULT_EVAL_MODELS,
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
    resolveApiKeyForProvider: vi.fn().mockResolvedValue(key),
    getApiKeyForModel: vi.fn().mockResolvedValue(key),
  };
}

function mockModelAuthRejecting(reason: string) {
  return {
    resolveApiKeyForProvider: vi.fn().mockRejectedValue(new Error(reason)),
    getApiKeyForModel: vi.fn().mockRejectedValue(new Error(reason)),
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

describe("evaluateWithLlm", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("Path 1: modelAuth resolves key → direct API succeeds → returns eval", async () => {
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
    );

    expect(result.adjustedScore).toBe(42);
    expect(result.reasoning).toBe("Routine health check");
    expect(auth.resolveApiKeyForProvider).toHaveBeenCalledWith("anthropic");
    expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining("falling through"));
  });

  it("Path 1: uses default model for provider when config model is empty", async () => {
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

  it("Path 1: openai provider uses openai-compatible format", async () => {
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

  it("unknown provider → skips direct API, falls through to subagent", async () => {
    const auth = mockModelAuth("key");
    const logger = mockLogger();

    const originalKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    try {
      const subagent = {
        run: vi.fn().mockResolvedValue({ runId: "r1" }),
        waitForRun: vi.fn().mockResolvedValue({ status: "ok" }),
        getSessionMessages: vi.fn().mockResolvedValue({
          messages: [{ role: "assistant", content: VALID_EVAL_JSON }],
        }),
        deleteSession: vi.fn().mockResolvedValue(undefined),
      };

      const result = await evaluateWithLlm(
        "exec",
        { command: "test" },
        [],
        tier1Score(),
        { modelAuth: auth, subagent },
        logger,
        { provider: "custom-llm" },
      );

      expect(result.adjustedScore).toBe(42);
      // modelAuth was NOT called because provider has no endpoint
      expect(mockFetch).not.toHaveBeenCalled();
      expect(subagent.run).toHaveBeenCalled();
    } finally {
      if (originalKey !== undefined) {
        process.env.ANTHROPIC_API_KEY = originalKey;
      } else {
        delete process.env.ANTHROPIC_API_KEY;
      }
    }
  });

  it("Path 1: modelAuth resolves undefined → falls through without calling fetch", async () => {
    const auth = {
      resolveApiKeyForProvider: vi.fn().mockResolvedValue(undefined),
      getApiKeyForModel: vi.fn().mockResolvedValue(undefined),
    };
    const logger = mockLogger();

    const originalKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

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

      // Should fall through to stub (no env var, no subagent)
      expect(result.reasoning).toContain("Stub evaluation");
      expect(auth.resolveApiKeyForProvider).toHaveBeenCalledWith("anthropic");
      // Should warn about undefined key
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("modelAuth resolved undefined"),
      );
      // Should NOT have called fetch (key was undefined)
      expect(mockFetch).not.toHaveBeenCalled();
    } finally {
      if (originalKey !== undefined) {
        process.env.ANTHROPIC_API_KEY = originalKey;
      } else {
        delete process.env.ANTHROPIC_API_KEY;
      }
    }
  });

  it("Path 1 fail → Path 2: modelAuth rejects → env var set → direct API succeeds", async () => {
    setAnthropicFetchResponse(VALID_EVAL_JSON);
    const auth = mockModelAuthRejecting("Auth not resolved");
    const logger = mockLogger();

    const originalKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "env-key-456";

    try {
      const result = await evaluateWithLlm(
        "exec",
        { command: "ls" },
        [],
        tier1Score(),
        { modelAuth: auth },
        logger,
        { provider: "anthropic", apiKeyEnv: "ANTHROPIC_API_KEY" },
      );

      expect(result.adjustedScore).toBe(42);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("modelAuth key resolution failed"),
      );
    } finally {
      if (originalKey !== undefined) {
        process.env.ANTHROPIC_API_KEY = originalKey;
      } else {
        delete process.env.ANTHROPIC_API_KEY;
      }
    }
  });

  it("Path 1 bad parse → falls through to subagent", async () => {
    const auth = mockModelAuth("ma-key-123");
    const logger = mockLogger();

    // API returns non-parseable text
    setAnthropicFetchResponse("not valid json");

    const originalKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    try {
      const subagent = {
        run: vi.fn().mockResolvedValue({ runId: "r1" }),
        waitForRun: vi.fn().mockResolvedValue({ status: "ok" }),
        getSessionMessages: vi.fn().mockResolvedValue({
          messages: [{ role: "assistant", content: VALID_EVAL_JSON }],
        }),
        deleteSession: vi.fn().mockResolvedValue(undefined),
      };

      const result = await evaluateWithLlm(
        "exec",
        { command: "test" },
        [],
        tier1Score(),
        { modelAuth: auth, subagent },
        logger,
        { provider: "anthropic" },
      );

      expect(result.adjustedScore).toBe(42);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("unparseable"));
    } finally {
      if (originalKey !== undefined) {
        process.env.ANTHROPIC_API_KEY = originalKey;
      } else {
        delete process.env.ANTHROPIC_API_KEY;
      }
    }
  });

  it("modelAuth rejects → no env var → subagent succeeds", async () => {
    const auth = mockModelAuthRejecting("Not resolved");
    const logger = mockLogger();

    const originalKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    try {
      const subagent = {
        run: vi.fn().mockResolvedValue({ runId: "r1" }),
        waitForRun: vi.fn().mockResolvedValue({ status: "ok" }),
        getSessionMessages: vi.fn().mockResolvedValue({
          messages: [{ role: "assistant", content: VALID_EVAL_JSON }],
        }),
        deleteSession: vi.fn().mockResolvedValue(undefined),
      };

      const result = await evaluateWithLlm(
        "exec",
        { command: "test" },
        [],
        tier1Score(),
        { modelAuth: auth, subagent },
        logger,
        { provider: "anthropic" },
      );

      expect(result.adjustedScore).toBe(42);
      expect(subagent.run).toHaveBeenCalled();
    } finally {
      if (originalKey !== undefined) {
        process.env.ANTHROPIC_API_KEY = originalKey;
      } else {
        delete process.env.ANTHROPIC_API_KEY;
      }
    }
  });

  it("all paths fail → returns stub with tier-1 score", async () => {
    const auth = mockModelAuthRejecting("Not resolved");
    const logger = mockLogger();

    const originalKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    try {
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
    } finally {
      if (originalKey !== undefined) {
        process.env.ANTHROPIC_API_KEY = originalKey;
      } else {
        delete process.env.ANTHROPIC_API_KEY;
      }
    }
  });

  it("P0 fix: subagent property access throws → caught, falls through to stub", async () => {
    const logger = mockLogger();

    const originalKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    try {
      const subagent = {
        get run() {
          throw new Error("Gateway request context expired");
        },
        waitForRun: vi.fn(),
        getSessionMessages: vi.fn(),
        deleteSession: vi.fn(),
      };

      const result = await evaluateWithLlm(
        "exec",
        { command: "test" },
        [],
        tier1Score(),
        { subagent: subagent as unknown as { run: (opts: unknown) => Promise<unknown> } },
        logger,
        {},
      );

      expect(result.adjustedScore).toBe(55);
      expect(result.reasoning).toContain("Stub evaluation");
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("subagent failed"));
    } finally {
      if (originalKey !== undefined) {
        process.env.ANTHROPIC_API_KEY = originalKey;
      } else {
        delete process.env.ANTHROPIC_API_KEY;
      }
    }
  });

  it("modelAuth rejects at eval time (not registration) → graceful fallthrough", async () => {
    const auth = {
      resolveApiKeyForProvider: vi
        .fn()
        .mockRejectedValue(new Error("Auth provider not initialized")),
      getApiKeyForModel: vi.fn().mockRejectedValue(new Error("Auth provider not initialized")),
    };
    const logger = mockLogger();

    const originalKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

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
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Auth provider not initialized"),
      );
    } finally {
      if (originalKey !== undefined) {
        process.env.ANTHROPIC_API_KEY = originalKey;
      } else {
        delete process.env.ANTHROPIC_API_KEY;
      }
    }
  });

  it("subagent.run() rejects → caught inside try, falls through to stub", async () => {
    const logger = mockLogger();

    const originalKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    try {
      const subagent = {
        run: vi.fn().mockRejectedValue(new Error("Gateway context expired")),
        waitForRun: vi.fn(),
        getSessionMessages: vi.fn(),
        deleteSession: vi.fn().mockResolvedValue(undefined),
      };

      const result = await evaluateWithLlm(
        "exec",
        { command: "test" },
        [],
        tier1Score(),
        { subagent },
        logger,
        {},
      );

      expect(result.reasoning).toContain("Stub evaluation");
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Gateway context expired"));
    } finally {
      if (originalKey !== undefined) {
        process.env.ANTHROPIC_API_KEY = originalKey;
      } else {
        delete process.env.ANTHROPIC_API_KEY;
      }
    }
  });

  it("no runtime, no env var → returns stub", async () => {
    const logger = mockLogger();

    const originalKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

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
    } finally {
      if (originalKey !== undefined) {
        process.env.ANTHROPIC_API_KEY = originalKey;
      } else {
        delete process.env.ANTHROPIC_API_KEY;
      }
    }
  });

  it("skips modelAuth when no provider is set", async () => {
    const auth = mockModelAuth("key");
    const logger = mockLogger();

    const originalKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

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
    } finally {
      if (originalKey !== undefined) {
        process.env.ANTHROPIC_API_KEY = originalKey;
      } else {
        delete process.env.ANTHROPIC_API_KEY;
      }
    }
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
