import type { PolicyEngine } from "../policy/engine";
import type { AuditLogger } from "../audit/logger";
import type { RateLimiter } from "../rate/limiter";
import type { ClawClipConfig } from "../config";
import type { BeforeToolCallEvent, BeforeToolCallResult } from "../types";

export function createBeforeToolCallHandler(
  engine: PolicyEngine,
  auditLogger: AuditLogger,
  rateLimiter: RateLimiter,
  config: ClawClipConfig,
) {
  return (
    event: BeforeToolCallEvent,
    _ctx: unknown,
  ): BeforeToolCallResult | void => {
    const { toolName, params, toolCallId } = event;

    try {
      const decision = engine.evaluate(
        toolName,
        params,
        (tn, rn, w) => rateLimiter.getCount(tn, rn, w),
      );

      const policy = engine.getPolicy();
      const defaultTimeout = policy?.defaults.approval_timeout ?? 300;
      const defaultTimeoutAction = policy?.defaults.timeout_action ?? "deny";

      // Log decision (fire-and-forget for allows — non-blocking write stream)
      auditLogger.logDecision({
        timestamp: new Date().toISOString(),
        toolName,
        toolCallId,
        params,
        policyRule: decision.ruleName,
        decision: decision.action,
        severity: decision.severity,
      });

      switch (decision.action) {
        case "block":
          return {
            block: true,
            blockReason: `ClawClip: ${decision.reason || "Blocked by policy"}`,
          };

        case "approval_required":
          return {
            requireApproval: {
              title: `ClawClip: ${decision.ruleName || "Policy approval"}`,
              description: formatApprovalDescription(toolName, params),
              severity: decision.severity || "warning",
              timeoutMs: (decision.timeout || defaultTimeout) * 1000,
              timeoutBehavior: decision.timeoutAction || defaultTimeoutAction,
              onResolution: (resolution) => {
                auditLogger.logApprovalResolution({
                  toolCallId,
                  toolName,
                  approved: resolution.approved,
                  resolvedBy: resolution.resolvedBy,
                });
              },
            },
          };

        case "allow":
        default:
          // Record for rate limiting
          rateLimiter.record(toolName, decision.ruleName);
          return; // void = allow
      }
    } catch (err) {
      // Fail closed: if anything throws, block the tool call
      auditLogger.logDecision({
        timestamp: new Date().toISOString(),
        toolName,
        toolCallId,
        params,
        decision: "block",
        severity: "critical",
      });
      return {
        block: true,
        blockReason: `ClawClip: Internal error — blocked for safety. ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  };
}

function formatApprovalDescription(
  toolName: string,
  params: Record<string, unknown>,
): string {
  const lines: string[] = [`The agent wants to use **${toolName}**`];

  // Show relevant params in readable form
  const interesting = ["command", "path", "url", "to", "content", "name"];
  for (const key of interesting) {
    if (params[key] !== undefined) {
      const value = String(params[key]);
      const display = value.length > 200 ? value.slice(0, 200) + "…" : value;
      lines.push(`  ${key}: \`${display}\``);
    }
  }

  return lines.join("\n");
}
