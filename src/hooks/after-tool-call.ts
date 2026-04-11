import type { AuditLogger } from "../audit/logger";
import type { AfterToolCallEvent } from "../types";

export function createAfterToolCallHandler(auditLogger: AuditLogger) {
  return (event: AfterToolCallEvent, _ctx: unknown): void => {
    auditLogger.logResult({
      timestamp: new Date().toISOString(),
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      executionResult: event.result ? "success" : "failure",
    });
  };
}
