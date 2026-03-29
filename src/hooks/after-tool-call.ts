import type { AuditLogger } from "../audit/logger";
import type { RateLimiter } from "../rate/limiter";
import type { AfterToolCallEvent } from "../types";

export function createAfterToolCallHandler(
  auditLogger: AuditLogger,
  rateLimiter: RateLimiter,
) {
  return (event: AfterToolCallEvent, _ctx: unknown): void => {
    auditLogger.logResult({
      timestamp: new Date().toISOString(),
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      executionResult: event.result ? "success" : "failure",
    });

    rateLimiter.record(event.toolName);
  };
}
