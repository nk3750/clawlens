import * as os from "node:os";
import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/risk/scorer", () => ({
  computeRiskScore: vi.fn(),
}));
vi.mock("../src/risk/llm-evaluator", () => ({
  evaluateWithLlm: vi.fn(),
}));
vi.mock("../src/alerts/telegram", () => ({
  shouldAlert: vi.fn().mockReturnValue(false),
  formatAlert: vi.fn().mockReturnValue("alert"),
  formatGuardrailNotifyAlert: vi.fn().mockReturnValue("[guardrail allow_notify] x"),
  sendAlert: vi.fn(),
}));

import { sendAlert } from "../src/alerts/telegram";
import { DEFAULT_CONFIG } from "../src/config";
import { GuardrailStore } from "../src/guardrails/store";
import type { Guardrail } from "../src/guardrails/types";
import { createBeforeToolCallHandler } from "../src/hooks/before-tool-call";
import { computeRiskScore } from "../src/risk/scorer";
import { SessionContext } from "../src/risk/session-context";

const mockComputeRiskScore = vi.mocked(computeRiskScore);
const mockSendAlert = vi.mocked(sendAlert);

function tmpStore(): GuardrailStore {
  const file = path.join(os.tmpdir(), `gr-hook-${Date.now()}-${Math.random()}.json`);
  const s = new GuardrailStore(file);
  s.load();
  return s;
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

function lowRisk() {
  return {
    score: 20,
    tier: "low" as const,
    tags: ["read-only"],
    breakdown: { base: 20, modifiers: [] },
    needsLlmEval: false,
  };
}

const ctx = { sessionKey: "test-session", agentId: "test-agent" };

let counter = 0;
function nextId(): string {
  counter++;
  return `gr_hk${counter.toString().padStart(6, "0")}`;
}

function mkRule(overrides: Partial<Guardrail> = {}): Guardrail {
  return {
    id: overrides.id ?? nextId(),
    selector: overrides.selector ?? {
      agent: "test-agent",
      tools: { mode: "names", values: ["exec"] },
    },
    target: overrides.target ?? { kind: "identity-glob", pattern: "**" },
    action: overrides.action ?? "block",
    description: overrides.description ?? "test rule",
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    source: overrides.source ?? {
      toolCallId: "tc-orig",
      sessionKey: "s1",
      agentId: "test-agent",
    },
    riskScore: overrides.riskScore ?? 50,
    note: overrides.note,
  };
}

describe("before_tool_call — flat-action handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockComputeRiskScore.mockReturnValue(lowRisk());
  });

  it("blocks when matched action is 'block' (flat string, not {type:'block'})", async () => {
    const auditLogger = mockAuditLogger();
    const store = tmpStore();
    store.add(
      mkRule({
        id: "gr_block",
        target: { kind: "identity-glob", pattern: "rm node_modules" },
        action: "block",
      }),
    );
    const handler = createBeforeToolCallHandler({
      auditLogger: auditLogger as never,
      config: { ...DEFAULT_CONFIG, guardrailsPath: "" },
      sessionContext: new SessionContext(),
      guardrailStore: store,
    });
    const result = await handler(
      { toolName: "exec", params: { command: "rm node_modules" }, toolCallId: "tc-001" },
      ctx,
    );
    expect(result?.block).toBe(true);
    expect(result?.blockReason).toContain("blocked");
    expect(auditLogger.logGuardrailMatch).toHaveBeenCalledOnce();
    const call = auditLogger.logGuardrailMatch.mock.calls[0][0];
    // Flat string, NOT { type: ... }
    expect(call.action).toBe("block");
    expect(call.guardrailId).toBe("gr_block");
    expect(call.targetSummary).toBe("Identity: rm node_modules");
    expect(call.identityKey).toBe("rm node_modules");
    expect(call.riskScore).toBeTypeOf("number");
  });

  it("returns requireApproval when action is 'require_approval'", async () => {
    const auditLogger = mockAuditLogger();
    const store = tmpStore();
    store.add(
      mkRule({
        id: "gr_approve",
        target: { kind: "identity-glob", pattern: "rm /tmp/data" },
        action: "require_approval",
      }),
    );
    const handler = createBeforeToolCallHandler({
      auditLogger: auditLogger as never,
      config: { ...DEFAULT_CONFIG, guardrailsPath: "" },
      sessionContext: new SessionContext(),
      guardrailStore: store,
    });
    const result = await handler(
      { toolName: "exec", params: { command: "rm /tmp/data" }, toolCallId: "tc-002" },
      ctx,
    );
    expect(result?.requireApproval).toBeDefined();
    expect(result?.requireApproval?.title).toBe("ClawLens Guardrail");
    expect(auditLogger.logGuardrailMatch).toHaveBeenCalledWith(
      expect.objectContaining({ action: "require_approval" }),
    );
  });

  it("allow_notify writes audit, fires alert, and falls through to normal allow path", async () => {
    const auditLogger = mockAuditLogger();
    const store = tmpStore();
    store.add(
      mkRule({
        id: "gr_notify",
        selector: { agent: null, tools: { mode: "any" } },
        target: { kind: "url-glob", pattern: "*://example.com/**" },
        action: "allow_notify",
      }),
    );
    const alertSend = vi.fn();
    const handler = createBeforeToolCallHandler({
      auditLogger: auditLogger as never,
      config: { ...DEFAULT_CONFIG, guardrailsPath: "" },
      sessionContext: new SessionContext(),
      guardrailStore: store,
      alertSend,
    });
    const result = await handler(
      { toolName: "web_fetch", params: { url: "https://example.com/x" }, toolCallId: "tc-003" },
      ctx,
    );
    // Falls through — no block, no requireApproval.
    expect(result).toBeUndefined();
    // Guardrail-match audit written.
    expect(auditLogger.logGuardrailMatch).toHaveBeenCalledWith(
      expect.objectContaining({ action: "allow_notify", guardrailId: "gr_notify" }),
    );
    // Alert fired via existing sendAlert path.
    expect(mockSendAlert).toHaveBeenCalledOnce();
    // Normal allow path continued: logDecision called for the underlying call.
    expect(auditLogger.logDecision).toHaveBeenCalledOnce();
  });

  it("passes through cleanly when no rule matches", async () => {
    const auditLogger = mockAuditLogger();
    const store = tmpStore();
    const handler = createBeforeToolCallHandler({
      auditLogger: auditLogger as never,
      config: { ...DEFAULT_CONFIG, guardrailsPath: "" },
      sessionContext: new SessionContext(),
      guardrailStore: store,
    });
    const result = await handler(
      { toolName: "exec", params: { command: "echo hello" }, toolCallId: "tc-005" },
      ctx,
    );
    expect(result).toBeUndefined();
    expect(auditLogger.logGuardrailMatch).not.toHaveBeenCalled();
    expect(auditLogger.logDecision).toHaveBeenCalledOnce();
  });

  it("works without guardrailStore (backward compatible)", async () => {
    const auditLogger = mockAuditLogger();
    const handler = createBeforeToolCallHandler({
      auditLogger: auditLogger as never,
      config: { ...DEFAULT_CONFIG, guardrailsPath: "" },
      sessionContext: new SessionContext(),
    });
    const result = await handler(
      { toolName: "exec", params: { command: "echo hi" }, toolCallId: "tc-006" },
      ctx,
    );
    expect(result).toBeUndefined();
    expect(mockComputeRiskScore).toHaveBeenCalledOnce();
  });

  it("allow-always resolution removes the matched rule", async () => {
    const auditLogger = mockAuditLogger();
    const store = tmpStore();
    store.add(
      mkRule({
        id: "gr_aa",
        target: { kind: "identity-glob", pattern: "safe-cmd" },
        action: "require_approval",
      }),
    );
    const handler = createBeforeToolCallHandler({
      auditLogger: auditLogger as never,
      config: { ...DEFAULT_CONFIG, guardrailsPath: "" },
      sessionContext: new SessionContext(),
      guardrailStore: store,
    });
    const result = await handler(
      { toolName: "exec", params: { command: "safe-cmd" }, toolCallId: "tc-aa" },
      ctx,
    );
    result?.requireApproval?.onResolution?.("allow-always");
    expect(store.list()).toHaveLength(0);
    expect(auditLogger.logGuardrailResolution).toHaveBeenCalledWith(
      expect.objectContaining({
        guardrailId: "gr_aa",
        approved: true,
        decision: "allow-always",
        storeAction: "removed",
      }),
    );
  });

  it("allow-once resolution leaves the rule intact", async () => {
    const auditLogger = mockAuditLogger();
    const store = tmpStore();
    store.add(
      mkRule({
        id: "gr_ao",
        target: { kind: "identity-glob", pattern: "maybe-cmd" },
        action: "require_approval",
      }),
    );
    const handler = createBeforeToolCallHandler({
      auditLogger: auditLogger as never,
      config: { ...DEFAULT_CONFIG, guardrailsPath: "" },
      sessionContext: new SessionContext(),
      guardrailStore: store,
    });
    const result = await handler(
      { toolName: "exec", params: { command: "maybe-cmd" }, toolCallId: "tc-ao" },
      ctx,
    );
    result?.requireApproval?.onResolution?.("allow-once");
    expect(store.list()).toHaveLength(1);
    expect(auditLogger.logGuardrailResolution).toHaveBeenCalledWith(
      expect.objectContaining({
        approved: true,
        decision: "allow-once",
        storeAction: "unchanged",
      }),
    );
  });

  it("deny resolution leaves the rule intact", async () => {
    const auditLogger = mockAuditLogger();
    const store = tmpStore();
    store.add(
      mkRule({
        id: "gr_dn",
        target: { kind: "identity-glob", pattern: "risky-cmd" },
        action: "require_approval",
      }),
    );
    const handler = createBeforeToolCallHandler({
      auditLogger: auditLogger as never,
      config: { ...DEFAULT_CONFIG, guardrailsPath: "" },
      sessionContext: new SessionContext(),
      guardrailStore: store,
    });
    const result = await handler(
      { toolName: "exec", params: { command: "risky-cmd" }, toolCallId: "tc-dn" },
      ctx,
    );
    result?.requireApproval?.onResolution?.("deny");
    expect(store.list()).toHaveLength(1);
    expect(auditLogger.logGuardrailResolution).toHaveBeenCalledWith(
      expect.objectContaining({ approved: false, decision: "deny", storeAction: "unchanged" }),
    );
  });

  it("logs warning + allows through when match() throws", async () => {
    const auditLogger = mockAuditLogger();
    const loggerMock = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const grStore = {
      match: vi.fn().mockImplementation(() => {
        throw new Error("corrupted store");
      }),
    };
    const handler = createBeforeToolCallHandler({
      auditLogger: auditLogger as never,
      config: { ...DEFAULT_CONFIG, guardrailsPath: "" },
      sessionContext: new SessionContext(),
      guardrailStore: grStore as never,
      logger: loggerMock,
    });
    const result = await handler(
      { toolName: "exec", params: { command: "echo x" }, toolCallId: "tc-err" },
      ctx,
    );
    expect(result).toBeUndefined();
    expect(loggerMock.warn).toHaveBeenCalledWith(expect.stringContaining("corrupted store"));
  });
});
