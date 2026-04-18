import type { AuditLogger } from "../audit/logger";
import type { AfterToolCallEvent } from "../types";

export function createAfterToolCallHandler(auditLogger: AuditLogger) {
  return (event: AfterToolCallEvent, ctx: Record<string, unknown>): void => {
    const sessionKey = (ctx?.sessionKey as string) || "default";
    auditLogger.logResult({
      timestamp: new Date().toISOString(),
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      executionResult: event.result ? "success" : "failure",
      agentId: ctx?.agentId as string | undefined,
      sessionKey: sessionKey !== "default" ? sessionKey : undefined,
    });
  };
}
