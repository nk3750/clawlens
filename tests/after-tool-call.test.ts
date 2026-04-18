import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditLogger } from "../src/audit/logger";
import { createAfterToolCallHandler } from "../src/hooks/after-tool-call";
import type { AfterToolCallEvent } from "../src/types";

function mockAuditLogger() {
  return {
    logResult: vi.fn(),
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

function makeEvent(overrides?: Partial<AfterToolCallEvent>): AfterToolCallEvent {
  return {
    toolName: "exec",
    params: { command: "ls" },
    result: "ok",
    toolCallId: "tc-after-001",
    ...overrides,
  };
}

describe("createAfterToolCallHandler", () => {
  let auditLogger: ReturnType<typeof mockAuditLogger>;

  beforeEach(() => {
    vi.clearAllMocks();
    auditLogger = mockAuditLogger();
  });

  it("writes agentId and sessionKey from ctx to logResult", () => {
    const handler = createAfterToolCallHandler(auditLogger as unknown as AuditLogger);

    handler(makeEvent(), { agentId: "worker-7", sessionKey: "session-abc" });

    expect(auditLogger.logResult).toHaveBeenCalledOnce();
    const call = auditLogger.logResult.mock.calls[0][0];
    expect(call).toMatchObject({
      toolName: "exec",
      toolCallId: "tc-after-001",
      executionResult: "success",
      agentId: "worker-7",
      sessionKey: "session-abc",
    });
  });

  it("drops the sessionKey 'default' sentinel so it does not pollute the entry", () => {
    const handler = createAfterToolCallHandler(auditLogger as unknown as AuditLogger);

    handler(makeEvent({ toolCallId: "tc-after-002" }), {
      agentId: "main",
      sessionKey: "default",
    });

    const call = auditLogger.logResult.mock.calls[0][0];
    expect(call.sessionKey).toBeUndefined();
    expect(call.agentId).toBe("main");
  });

  it("writes a valid entry when ctx is an empty object (no agentId, no sessionKey)", () => {
    const handler = createAfterToolCallHandler(auditLogger as unknown as AuditLogger);

    handler(makeEvent({ toolCallId: "tc-after-003" }), {});

    expect(auditLogger.logResult).toHaveBeenCalledOnce();
    const call = auditLogger.logResult.mock.calls[0][0];
    expect(call.toolCallId).toBe("tc-after-003");
    expect(call.agentId).toBeUndefined();
    expect(call.sessionKey).toBeUndefined();
  });

  it("records executionResult: 'failure' when result is falsy (null)", () => {
    const handler = createAfterToolCallHandler(auditLogger as unknown as AuditLogger);

    handler(makeEvent({ result: null, toolCallId: "tc-after-004" }), {
      agentId: "worker-7",
      sessionKey: "session-xyz",
    });

    const call = auditLogger.logResult.mock.calls[0][0];
    expect(call.executionResult).toBe("failure");
    expect(call.agentId).toBe("worker-7");
    expect(call.sessionKey).toBe("session-xyz");
  });
});
