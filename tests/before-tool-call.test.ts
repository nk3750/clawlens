import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClawLensConfig } from "../src/config";
import { DEFAULT_CONFIG } from "../src/config";
import {
  type BeforeToolCallDeps,
  createBeforeToolCallHandler,
  extractApprovalDetail,
} from "../src/hooks/before-tool-call";
import { REDACTION_MARKERS } from "../src/privacy/redaction";
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

vi.mock("../src/alerts/alert-format", () => ({
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
    logGuardrailMatch: vi.fn(),
    logGuardrailResolution: vi.fn(),
    init: vi.fn(),
    readEntries: vi.fn().mockReturnValue([]),
    flush: vi.fn(),
  };
}

function mockPendingApprovalStore() {
  return {
    put: vi.fn(),
    take: vi.fn(),
    peek: vi.fn(),
    size: vi.fn().mockReturnValue(0),
    shutdown: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  };
}

function mockGuardrailStore(match: unknown) {
  return {
    load: vi.fn(),
    list: vi.fn().mockReturnValue([]),
    match: vi.fn().mockReturnValue(match),
    peek: vi.fn().mockReturnValue(match),
    add: vi.fn(),
    update: vi.fn(),
    remove: vi.fn().mockReturnValue(true),
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
    alerts: {
      ...DEFAULT_CONFIG.alerts,
      enabled: true,
      threshold: 80,
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
        agentId: "test-agent",
        sessionKey: "test-session",
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
        agentId: "test-agent",
        sessionKey: "test-session",
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
        agentId: "test-agent",
        sessionKey: "test-session",
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
        agentId: "test-agent",
        sessionKey: "test-session",
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

describe("require_approval wrap — PendingApprovalStore integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockComputeRiskScore.mockReturnValue(lowRisk());
  });

  const guardrailMatch = {
    id: "gr_1",
    selector: { agent: "test-agent", tools: { mode: "names" as const, values: ["exec"] } },
    target: { kind: "identity-glob" as const, pattern: "exec:curl https://example.com" },
    action: "require_approval" as const,
    createdAt: new Date().toISOString(),
    source: { toolCallId: "tc_src", sessionKey: "test-session", agentId: "test-agent" },
    description: "Needs review",
    riskScore: 70,
  };

  it("stashes the approval in the store with the correct fields", async () => {
    const store = mockPendingApprovalStore();
    const deps = makeDeps({
      guardrailStore: mockGuardrailStore(
        guardrailMatch,
      ) as unknown as BeforeToolCallDeps["guardrailStore"],
      pendingApprovalStore: store as unknown as BeforeToolCallDeps["pendingApprovalStore"],
    });
    const handler = createBeforeToolCallHandler(deps);
    const result = await handler(makeEvent({ toolCallId: "tc-wrap-001" }), ctx);

    expect(result?.requireApproval).toBeDefined();
    expect(store.put).toHaveBeenCalledTimes(1);
    const stashed = store.put.mock.calls[0][0];
    expect(stashed).toMatchObject({
      toolCallId: "tc-wrap-001",
      agentId: "test-agent",
      toolName: "exec",
      timeoutMs: 300_000,
    });
    expect(typeof stashed.stashedAt).toBe("number");
    expect(typeof stashed.resolve).toBe("function");
  });

  it("invoking the stashed resolve() fires logGuardrailResolution and calls store.take()", async () => {
    const store = mockPendingApprovalStore();
    const auditLogger = mockAuditLogger();
    const deps = makeDeps({
      auditLogger: auditLogger as unknown as BeforeToolCallDeps["auditLogger"],
      guardrailStore: mockGuardrailStore(
        guardrailMatch,
      ) as unknown as BeforeToolCallDeps["guardrailStore"],
      pendingApprovalStore: store as unknown as BeforeToolCallDeps["pendingApprovalStore"],
    });
    const handler = createBeforeToolCallHandler(deps);
    await handler(makeEvent({ toolCallId: "tc-wrap-002" }), ctx);

    const stashed = store.put.mock.calls[0][0];
    await stashed.resolve("allow-once");
    expect(store.take).toHaveBeenCalledWith("tc-wrap-002");
    expect(auditLogger.logGuardrailResolution).toHaveBeenCalledWith(
      expect.objectContaining({
        guardrailId: "gr_1",
        toolCallId: "tc-wrap-002",
        approved: true,
        decision: "allow-once",
        agentId: "test-agent",
        sessionKey: "test-session",
      }),
    );
  });

  it("requireApproval.onResolution is the same wrapper stashed in the store", async () => {
    const store = mockPendingApprovalStore();
    const deps = makeDeps({
      guardrailStore: mockGuardrailStore(
        guardrailMatch,
      ) as unknown as BeforeToolCallDeps["guardrailStore"],
      pendingApprovalStore: store as unknown as BeforeToolCallDeps["pendingApprovalStore"],
    });
    const handler = createBeforeToolCallHandler(deps);
    const result = await handler(makeEvent({ toolCallId: "tc-wrap-003" }), ctx);

    const stashed = store.put.mock.calls[0][0];
    const onResolution = result?.requireApproval?.onResolution;
    // OpenClaw will call this directly on Telegram resolution — must drain
    // the store in the same way as the stashed wrapped resolver.
    await onResolution?.("deny");
    expect(store.take).toHaveBeenCalledWith("tc-wrap-003");
    // Calling the stashed resolve() separately also triggers another take —
    // which is safe because take() is single-winner on the real store.
    await stashed.resolve("deny");
    expect(store.take).toHaveBeenCalledTimes(2);
  });

  it("omitting pendingApprovalStore keeps the approval path working (no wrap, no crash)", async () => {
    const auditLogger = mockAuditLogger();
    const deps = makeDeps({
      auditLogger: auditLogger as unknown as BeforeToolCallDeps["auditLogger"],
      guardrailStore: mockGuardrailStore(
        guardrailMatch,
      ) as unknown as BeforeToolCallDeps["guardrailStore"],
      // No pendingApprovalStore — simulates pre-wiring / test harness.
    });
    const handler = createBeforeToolCallHandler(deps);
    const result = await handler(makeEvent({ toolCallId: "tc-wrap-004" }), ctx);

    expect(result?.requireApproval?.onResolution).toBeDefined();
    await result?.requireApproval?.onResolution?.("allow-once");
    expect(auditLogger.logGuardrailResolution).toHaveBeenCalledWith(
      expect.objectContaining({ approved: true }),
    );
  });

  it("does not stash when toolCallId is missing (OpenClaw contract edge)", async () => {
    const store = mockPendingApprovalStore();
    const deps = makeDeps({
      guardrailStore: mockGuardrailStore(
        guardrailMatch,
      ) as unknown as BeforeToolCallDeps["guardrailStore"],
      pendingApprovalStore: store as unknown as BeforeToolCallDeps["pendingApprovalStore"],
    });
    const handler = createBeforeToolCallHandler(deps);
    const result = await handler(makeEvent({ toolCallId: undefined }), ctx);

    // We still return the approval so OpenClaw can prompt, but we have
    // nothing to key off in the store.
    expect(result?.requireApproval).toBeDefined();
    expect(store.put).not.toHaveBeenCalled();
  });
});

describe("guardrail match audit row carries the action's risk score", () => {
  // Closes the dashboard's risk-mix bar gap: previously logGuardrailMatch wrote
  // an audit row with a `decision` but no `riskScore`, so the row counted in
  // todayToolCalls (denominator) but never bucketed into todayRiskMix
  // (numerator), leaving 1−sum(mix)/total empty space on the per-agent bar.
  // Computing the risk score eagerly (cheap, pure) and persisting it on the
  // guardrail-match row closes the gap for new entries — old entries fall
  // back via the api.ts decision-based bucketing.
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function approvalGuardrail() {
    return {
      id: "gr_appr",
      selector: { agent: "test-agent", tools: { mode: "names" as const, values: ["exec"] } },
      target: { kind: "identity-glob" as const, pattern: "exec:curl https://example.com" },
      action: "require_approval" as const,
      createdAt: new Date().toISOString(),
      source: { toolCallId: "tc_src", sessionKey: "test-session", agentId: "test-agent" },
      description: "Needs review",
      riskScore: 70,
    };
  }

  function blockGuardrail() {
    return {
      id: "gr_block",
      selector: { agent: "test-agent", tools: { mode: "names" as const, values: ["exec"] } },
      target: { kind: "identity-glob" as const, pattern: "exec:rm -rf /" },
      action: "block" as const,
      createdAt: new Date().toISOString(),
      source: { toolCallId: "tc_src", sessionKey: "test-session", agentId: "test-agent" },
      description: "Blocked",
      riskScore: 95,
    };
  }

  it("writes the computed riskScore on the require_approval audit row", async () => {
    mockComputeRiskScore.mockReturnValue(highRisk()); // score = 65
    const auditLogger = mockAuditLogger();
    const deps = makeDeps({
      auditLogger: auditLogger as unknown as BeforeToolCallDeps["auditLogger"],
      guardrailStore: mockGuardrailStore(
        approvalGuardrail(),
      ) as unknown as BeforeToolCallDeps["guardrailStore"],
    });
    const handler = createBeforeToolCallHandler(deps);
    await handler(makeEvent({ toolCallId: "tc-appr-001" }), ctx);

    expect(auditLogger.logGuardrailMatch).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: "tc-appr-001",
        guardrailId: "gr_appr",
        riskScore: 65,
        riskTier: "high",
      }),
    );
  });

  it("writes the computed riskScore on the block audit row", async () => {
    mockComputeRiskScore.mockReturnValue({
      score: 90,
      tier: "critical",
      tags: ["destructive"],
      breakdown: { base: 90, modifiers: [] },
      needsLlmEval: false,
    });
    const auditLogger = mockAuditLogger();
    const deps = makeDeps({
      auditLogger: auditLogger as unknown as BeforeToolCallDeps["auditLogger"],
      guardrailStore: mockGuardrailStore(
        blockGuardrail(),
      ) as unknown as BeforeToolCallDeps["guardrailStore"],
    });
    const handler = createBeforeToolCallHandler(deps);
    const result = await handler(makeEvent({ toolCallId: "tc-block-001" }), ctx);

    // Block branch returns block:true with a reason — sanity check we're on the
    // right code path, then assert the audit row carries the risk score.
    expect(result?.block).toBe(true);
    expect(auditLogger.logGuardrailMatch).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: "tc-block-001",
        guardrailId: "gr_block",
        riskScore: 90,
        riskTier: "critical",
      }),
    );
  });
});

// ── extractApprovalDetail ────────────────────────────────────
//
// Surfaces the human-readable detail line in the guardrail-approval modal.
// process and message tools historically read wrong param keys (issue #43);
// these tests lock in the corrected shapes.
describe("extractApprovalDetail", () => {
  it("exec returns command", () => {
    expect(extractApprovalDetail("exec", { command: "ls -la" })).toBe("ls -la");
  });

  it("process returns action:sessionId", () => {
    expect(extractApprovalDetail("process", { action: "poll", sessionId: "s_abc" })).toBe(
      "poll:s_abc",
    );
  });

  it("process returns action:'' when sessionId missing", () => {
    expect(extractApprovalDetail("process", { action: "poll" })).toBe("poll:");
  });

  it("process returns '' when both action and sessionId missing", () => {
    expect(extractApprovalDetail("process", {})).toBe("");
  });

  it("message returns action:target", () => {
    expect(extractApprovalDetail("message", { action: "send", target: "#alerts" })).toBe(
      "send:#alerts",
    );
  });

  it("message falls back to channel when target missing", () => {
    expect(extractApprovalDetail("message", { action: "send", channel: "#ops" })).toBe("send:#ops");
  });

  it("message: target wins over channel when both present", () => {
    expect(extractApprovalDetail("message", { action: "send", target: "#a", channel: "#b" })).toBe(
      "send:#a",
    );
  });

  it("message returns '' when action/target/channel all missing", () => {
    expect(extractApprovalDetail("message", {})).toBe("");
  });

  it("read returns path", () => {
    expect(extractApprovalDetail("read", { path: "/etc/hosts" })).toBe("/etc/hosts");
  });

  // pi-coding-agent registers `find` (not `glob`) and `ls` — see #47.
  it("find returns pattern", () => {
    expect(extractApprovalDetail("find", { pattern: "**/*.env" })).toBe("**/*.env");
  });

  it("ls returns path", () => {
    expect(extractApprovalDetail("ls", { path: "/a/b" })).toBe("/a/b");
  });

  it("regression: bare search arm is dropped — falls through to '' (#47)", () => {
    // Was a dead arm; pi-coding-agent never registered a `search` tool.
    expect(extractApprovalDetail("search", { query: "anything" })).toBe("");
  });

  it("unknown tool returns ''", () => {
    expect(extractApprovalDetail("unknown_tool", { foo: "bar" })).toBe("");
  });
});

// v1.0.1 §2A: tool-call params are sanitized BEFORE they cross the trust
// boundary into audit logs, the session context (where they'd be replayed
// into LLM prompts as recent-action context), LLM eval payloads, and any
// outbound alert/notification text. Local guardrail matching and the
// deterministic scorer still see raw params — the hook must redact
// downstream-only.
describe("before_tool_call — param sanitization at the trust boundary", () => {
  const SK_TOKEN = "sk-test-abcdefghijklmnopqrstuvwxyz123456";
  const GHP_TOKEN = "ghp_abcdef0123456789abcdef0123456789abcd";

  beforeEach(() => {
    vi.clearAllMocks();
    mockComputeRiskScore.mockReturnValue(highRisk());
  });

  // ── alert mock spy: bring the alert-format mock into the test scope ────
  async function getFormatAlertMock() {
    const mod = await import("../src/alerts/alert-format");
    return vi.mocked(mod.formatAlert);
  }
  async function getSendAlertMock() {
    const mod = await import("../src/alerts/alert-format");
    return vi.mocked(mod.sendAlert);
  }

  it("writes sanitized params to the audit log decision row", async () => {
    const auditLogger = mockAuditLogger();
    const deps = makeDeps({
      auditLogger: auditLogger as unknown as BeforeToolCallDeps["auditLogger"],
    });
    const handler = createBeforeToolCallHandler(deps);

    await handler(
      makeEvent({
        toolName: "exec",
        params: { command: `curl -H "Authorization: Bearer ${SK_TOKEN}" https://api.example.com` },
      }),
      ctx,
    );

    const call = auditLogger.logDecision.mock.calls[0][0];
    const params = call.params as Record<string, unknown>;
    expect(params.command).not.toContain(SK_TOKEN);
    expect(params.command).toContain("curl");
    expect(params.command).toContain("api.example.com");
  });

  it("passes sanitized params to evaluateWithLlm", async () => {
    mockEvaluateWithLlm.mockResolvedValue(realEval());

    const deps = makeDeps();
    const handler = createBeforeToolCallHandler(deps);

    await handler(
      makeEvent({
        params: { command: `GITHUB_TOKEN=${GHP_TOKEN} npm publish` },
      }),
      ctx,
    );

    expect(mockEvaluateWithLlm).toHaveBeenCalledOnce();
    const callArgs = mockEvaluateWithLlm.mock.calls[0];
    const evalParams = callArgs[1] as Record<string, unknown>;
    expect(evalParams.command).not.toContain(GHP_TOKEN);
  });

  it("stores sanitized params in the session context (recent-action context for future evals)", async () => {
    const sessionContext = new SessionContext();
    mockEvaluateWithLlm.mockResolvedValue(realEval());

    const deps = makeDeps({ sessionContext });
    const handler = createBeforeToolCallHandler(deps);

    await handler(
      makeEvent({
        params: { apiKey: SK_TOKEN, foo: "bar" },
      }),
      ctx,
    );

    const recent = sessionContext.getRecent("test-session", 5);
    expect(recent).toHaveLength(1);
    const recordedParams = recent[0].params as Record<string, unknown>;
    expect(recordedParams.apiKey).toBe(REDACTION_MARKERS.token);
    expect(recordedParams.apiKey).not.toBe(SK_TOKEN);
    expect(recordedParams.foo).toBe("bar");
  });

  it("passes sanitized params to formatAlert when alert fires", async () => {
    mockComputeRiskScore.mockReturnValue({
      score: 90,
      tier: "critical",
      tags: ["destructive"],
      breakdown: { base: 90, modifiers: [] },
      needsLlmEval: false,
    });

    const formatAlert = await getFormatAlertMock();
    const sendAlertSpy = await getSendAlertMock();
    const mod = await import("../src/alerts/alert-format");
    vi.mocked(mod.shouldAlert).mockReturnValueOnce(true);

    const alertSend = vi.fn();
    const deps = makeDeps({ alertSend });
    const handler = createBeforeToolCallHandler(deps);

    await handler(
      makeEvent({
        params: { command: `curl -H "Authorization: Bearer ${SK_TOKEN}" https://x.com` },
      }),
      ctx,
    );

    expect(sendAlertSpy).toHaveBeenCalled();
    const callArgs = formatAlert.mock.calls[0];
    const alertParams = callArgs[1] as Record<string, unknown>;
    expect(alertParams.command).not.toContain(SK_TOKEN);
  });
});
