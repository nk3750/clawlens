import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClawLensConfig } from "../src/config";
import { DEFAULT_CONFIG } from "../src/config";
import {
  type BeforeToolCallDeps,
  createBeforeToolCallHandler,
} from "../src/hooks/before-tool-call";
import { EvalCache } from "../src/risk/eval-cache";
import { SessionContext } from "../src/risk/session-context";
import type { LlmRiskEvaluation, RiskScore } from "../src/risk/types";
import type { BeforeToolCallEvent } from "../src/types";

// ── Module mocks ────────────────────────────────────────

vi.mock("../src/risk/scorer", () => ({
  computeRiskScore: vi.fn(),
}));

vi.mock("../src/risk/llm-evaluator", () => ({
  evaluateWithLlm: vi.fn(),
}));

vi.mock("../src/alerts/telegram", () => ({
  shouldAlert: vi.fn().mockReturnValue(false),
  formatAlert: vi.fn().mockReturnValue("alert"),
  sendAlert: vi.fn(),
}));

import { evaluateWithLlm } from "../src/risk/llm-evaluator";
import { computeRiskScore } from "../src/risk/scorer";

const mockComputeRiskScore = vi.mocked(computeRiskScore);
const mockEvaluateWithLlm = vi.mocked(evaluateWithLlm);

// ── Helpers ─────────────────────────────────────────────

function mockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function mockAuditLogger() {
  return {
    logDecision: vi.fn(),
    appendEvaluation: vi.fn(),
    logApprovalResolution: vi.fn(),
    init: vi.fn(),
    readEntries: vi.fn().mockReturnValue([]),
    flush: vi.fn(),
  };
}

function lowRisk(): RiskScore {
  return {
    score: 20,
    tier: "low",
    tags: ["read-only"],
    breakdown: { base: 20, modifiers: [] },
    needsLlmEval: false,
  };
}

function highRisk(): RiskScore {
  return {
    score: 65,
    tier: "high",
    tags: ["network", "write"],
    breakdown: { base: 60, modifiers: [{ reason: "network", delta: 5 }] },
    needsLlmEval: true,
  };
}

function realEval(): LlmRiskEvaluation {
  return {
    adjustedScore: 42,
    reasoning: "Routine network call, low actual risk",
    tags: ["network"],
    confidence: "high",
    patterns: [],
  };
}

function stubEval(score: number): LlmRiskEvaluation {
  return {
    adjustedScore: score,
    reasoning: "Stub evaluation — LLM evaluation unavailable",
    tags: ["network"],
    confidence: "low",
    patterns: [],
  };
}

function makeConfig(overrides?: Partial<ClawLensConfig>): ClawLensConfig {
  return {
    ...DEFAULT_CONFIG,
    risk: {
      ...DEFAULT_CONFIG.risk,
      llmEnabled: true,
      llmEvalThreshold: 50,
    },
    ...overrides,
  };
}

function makeDeps(overrides?: Partial<BeforeToolCallDeps>): BeforeToolCallDeps {
  return {
    auditLogger: mockAuditLogger() as unknown as BeforeToolCallDeps["auditLogger"],
    config: makeConfig(),
    sessionContext: new SessionContext(),
    evalCache: new EvalCache(),
    alertSend: undefined,
    logger: mockLogger(),
    runtime: undefined,
    provider: "anthropic",
    ...overrides,
  };
}

function makeEvent(overrides?: Partial<BeforeToolCallEvent>): BeforeToolCallEvent {
  return {
    toolName: "exec",
    params: { command: "curl https://example.com" },
    toolCallId: "tc-001",
    ...overrides,
  };
}

const ctx = { sessionKey: "test-session", agentId: "test-agent" };

// ── Tests ───────────────────────────────────────────────

describe("createBeforeToolCallHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockComputeRiskScore.mockReturnValue(lowRisk());
  });

  it("returns an async function (Promise-returning handler)", () => {
    const handler = createBeforeToolCallHandler(makeDeps());
    const result = handler(makeEvent(), ctx);
    expect(result).toBeInstanceOf(Promise);
  });

  it("resolves normally for low-risk actions that skip LLM eval", async () => {
    mockComputeRiskScore.mockReturnValue(lowRisk());
    const handler = createBeforeToolCallHandler(makeDeps());

    const result = await handler(makeEvent(), ctx);

    // Always returns undefined (allow through)
    expect(result).toBeUndefined();
    expect(mockEvaluateWithLlm).not.toHaveBeenCalled();
  });

  it("awaits LLM eval before resolving when risk.needsLlmEval is true", async () => {
    mockComputeRiskScore.mockReturnValue(highRisk());
    const evaluation = realEval();
    mockEvaluateWithLlm.mockResolvedValue(evaluation);

    const auditLogger = mockAuditLogger();
    const deps = makeDeps({
      auditLogger: auditLogger as unknown as BeforeToolCallDeps["auditLogger"],
    });
    const handler = createBeforeToolCallHandler(deps);

    await handler(makeEvent(), ctx);

    // evaluateWithLlm was called and awaited
    expect(mockEvaluateWithLlm).toHaveBeenCalledOnce();
    // appendEvaluation was called with the real eval BEFORE handler resolved
    expect(auditLogger.appendEvaluation).toHaveBeenCalledWith(
      expect.objectContaining({
        refToolCallId: "tc-001",
        llmEvaluation: evaluation,
        riskScore: 42,
      }),
    );
  });

  it("writes stub audit entry when eval returns stub", async () => {
    mockComputeRiskScore.mockReturnValue(highRisk());
    mockEvaluateWithLlm.mockResolvedValue(stubEval(65));

    const auditLogger = mockAuditLogger();
    const deps = makeDeps({
      auditLogger: auditLogger as unknown as BeforeToolCallDeps["auditLogger"],
    });
    const handler = createBeforeToolCallHandler(deps);

    await handler(makeEvent(), ctx);

    expect(auditLogger.appendEvaluation).toHaveBeenCalledWith(
      expect.objectContaining({
        refToolCallId: "tc-001",
        llmEvaluation: expect.objectContaining({
          reasoning: "LLM evaluation unavailable",
          confidence: "none",
        }),
      }),
    );
  });

  it("cache hit skips LLM eval entirely", async () => {
    mockComputeRiskScore.mockReturnValue(highRisk());

    const evalCache = new EvalCache();
    // Pre-populate cache
    evalCache.maybeCache(
      "exec",
      { command: "curl https://example.com" },
      { adjustedScore: 30, confidence: "high", tags: ["network"], reasoning: "Safe" },
      50,
    );

    const auditLogger = mockAuditLogger();
    const deps = makeDeps({
      evalCache,
      auditLogger: auditLogger as unknown as BeforeToolCallDeps["auditLogger"],
    });
    const handler = createBeforeToolCallHandler(deps);

    await handler(makeEvent(), ctx);

    // LLM eval was NOT called — cache hit
    expect(mockEvaluateWithLlm).not.toHaveBeenCalled();
    // But appendEvaluation was called with cached result
    expect(auditLogger.appendEvaluation).toHaveBeenCalledWith(
      expect.objectContaining({
        refToolCallId: "tc-001",
        llmEvaluation: expect.objectContaining({
          reasoning: expect.stringContaining("(cached)"),
        }),
      }),
    );
  });

  it("eval rejection does not crash handler — writes failure audit entry", async () => {
    mockComputeRiskScore.mockReturnValue(highRisk());
    mockEvaluateWithLlm.mockRejectedValue(new Error("Gateway context expired"));

    const auditLogger = mockAuditLogger();
    const logger = mockLogger();
    const deps = makeDeps({
      auditLogger: auditLogger as unknown as BeforeToolCallDeps["auditLogger"],
      logger,
    });
    const handler = createBeforeToolCallHandler(deps);

    // Should NOT throw
    const result = await handler(makeEvent(), ctx);
    expect(result).toBeUndefined();

    // Failure audit entry written
    expect(auditLogger.appendEvaluation).toHaveBeenCalledWith(
      expect.objectContaining({
        llmEvaluation: expect.objectContaining({
          reasoning: expect.stringContaining("Gateway context expired"),
        }),
      }),
    );
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Gateway context expired"));
  });

  it("skips LLM eval when llmEnabled is false", async () => {
    mockComputeRiskScore.mockReturnValue(highRisk());
    const deps = makeDeps({
      config: makeConfig({
        risk: { ...DEFAULT_CONFIG.risk, llmEnabled: false },
      }),
    });
    const handler = createBeforeToolCallHandler(deps);

    await handler(makeEvent(), ctx);

    expect(mockEvaluateWithLlm).not.toHaveBeenCalled();
  });

  it("skips LLM eval when toolCallId is missing", async () => {
    mockComputeRiskScore.mockReturnValue(highRisk());
    const deps = makeDeps();
    const handler = createBeforeToolCallHandler(deps);

    await handler(makeEvent({ toolCallId: undefined }), ctx);

    expect(mockEvaluateWithLlm).not.toHaveBeenCalled();
  });

  it("reads runtime from deps at call time (mutable ref)", async () => {
    mockComputeRiskScore.mockReturnValue(highRisk());
    // Return stub so it doesn't get cached (confidence: "low")
    mockEvaluateWithLlm.mockResolvedValue(stubEval(65));

    const deps = makeDeps({ runtime: undefined, evalCache: new EvalCache() });
    const handler = createBeforeToolCallHandler(deps);

    // First call — runtime is undefined
    await handler(makeEvent(), ctx);
    expect(mockEvaluateWithLlm).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      undefined, // runtime
      expect.anything(),
      expect.anything(),
      undefined, // openClawConfig
    );

    vi.clearAllMocks();
    mockComputeRiskScore.mockReturnValue(highRisk());
    mockEvaluateWithLlm.mockResolvedValue(stubEval(65));

    // Mutate deps.runtime (simulates index.ts refreshing on re-register)
    const newRuntime = {
      modelAuth: {
        resolveApiKeyForProvider: vi.fn(),
      },
    };
    deps.runtime = newRuntime;

    // Use different params to avoid any cache interaction
    await handler(makeEvent({ toolCallId: "tc-002", params: { command: "ls -la /tmp" } }), ctx);
    expect(mockEvaluateWithLlm).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      newRuntime, // updated runtime
      expect.anything(),
      expect.anything(),
      undefined, // openClawConfig
    );
  });
});
