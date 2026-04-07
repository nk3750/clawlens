import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildEvalMessage,
  callAnthropicApi,
  evaluateWithLlm,
  parseEvalResponse,
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

/** Minimal mock logger that captures calls */
function mockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

/** Create a mock modelAuth that resolves a key */
function mockModelAuth(key: string) {
  return {
    resolveApiKeyForProvider: vi.fn().mockResolvedValue(key),
    getApiKeyForModel: vi.fn().mockResolvedValue(key),
  };
}

/** Create a mock modelAuth that rejects */
function mockModelAuthRejecting(reason: string) {
  return {
    resolveApiKeyForProvider: vi.fn().mockRejectedValue(new Error(reason)),
    getApiKeyForModel: vi.fn().mockRejectedValue(new Error(reason)),
  };
}

// ── Mock the Anthropic SDK ───────────────────────────────

const mockCreateFn = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: mockCreateFn };
  },
}));

function setAnthropicResponse(text: string) {
  mockCreateFn.mockResolvedValue({
    content: [{ type: "text", text }],
  });
}

function setAnthropicError(error: Error) {
  mockCreateFn.mockRejectedValue(error);
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

describe("callAnthropicApi", () => {
  beforeEach(() => {
    mockCreateFn.mockReset();
  });

  it("returns parsed eval on success", async () => {
    setAnthropicResponse(VALID_EVAL_JSON);
    const result = await callAnthropicApi("test-key", "claude-haiku-4-5-20251001", "test message");
    expect(result).not.toBeNull();
    expect(result!.adjustedScore).toBe(42);
  });

  it("returns null on unparseable response", async () => {
    setAnthropicResponse("Not valid JSON at all");
    const logger = mockLogger();
    const result = await callAnthropicApi(
      "test-key",
      "claude-haiku-4-5-20251001",
      "test message",
      logger,
    );
    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("unparseable"));
  });

  it("returns null on API error", async () => {
    setAnthropicError(new Error("Rate limited"));
    const logger = mockLogger();
    const result = await callAnthropicApi(
      "test-key",
      "claude-haiku-4-5-20251001",
      "test message",
      logger,
    );
    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Rate limited"));
  });

  it("returns null on timeout", async () => {
    // Simulate what happens when the timeout fires: the Promise.race rejects with a timeout error
    mockCreateFn.mockRejectedValue(new Error("Direct API timeout (15s)"));
    const logger = mockLogger();
    const result = await callAnthropicApi(
      "test-key",
      "claude-haiku-4-5-20251001",
      "test message",
      logger,
    );

    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("timeout"));
  });
});

describe("evaluateWithLlm", () => {
  beforeEach(() => {
    mockCreateFn.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("Path 1: modelAuth resolves key → direct API succeeds → returns eval", async () => {
    setAnthropicResponse(VALID_EVAL_JSON);
    const auth = mockModelAuth("ma-key-123");
    const logger = mockLogger();

    const result = await evaluateWithLlm(
      "exec",
      { command: "curl https://example.com" },
      [],
      tier1Score(),
      { modelAuth: auth },
      logger,
      { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
    );

    expect(result.adjustedScore).toBe(42);
    expect(result.reasoning).toBe("Routine health check");
    expect(auth.resolveApiKeyForProvider).toHaveBeenCalledWith("anthropic");
    // Should NOT have fallen through
    expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining("falling through"));
  });

  it("Path 1 fail → Path 2: modelAuth rejects → env var set → direct API succeeds", async () => {
    setAnthropicResponse(VALID_EVAL_JSON);
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
    // modelAuth succeeds but API returns garbage
    const auth = mockModelAuth("ma-key-123");
    const logger = mockLogger();

    // First call (modelAuth path) returns bad JSON, second call shouldn't happen (no env key)
    mockCreateFn.mockResolvedValue({
      content: [{ type: "text", text: "not valid json" }],
    });

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
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("modelAuth API call returned no result"),
      );
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
      // Subagent where accessing .run throws (simulating the original bug scenario)
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

      // Should gracefully return stub, not throw
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
    // modelAuth exists but rejects when called (auth not yet resolved)
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
        {
          /* no provider */
        },
      );

      // modelAuth should not have been called (no provider)
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
