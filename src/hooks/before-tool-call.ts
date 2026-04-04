import type { PolicyEngine } from "../policy/engine";
import type { AuditLogger } from "../audit/logger";
import type { RateLimiter } from "../rate/limiter";
import type { ClawLensConfig } from "../config";
import type { BeforeToolCallEvent, BeforeToolCallResult } from "../types";
import type { SessionContext } from "../risk/session-context";
import type { RiskScore } from "../risk/types";
import { computeRiskScore } from "../risk/scorer";
import { shouldAlert, formatAlert, sendAlert } from "../alerts/telegram";
import { evaluateWithLlm } from "../risk/llm-evaluator";

export interface BeforeToolCallDeps {
  engine: PolicyEngine;
  auditLogger: AuditLogger;
  rateLimiter: RateLimiter;
  config: ClawLensConfig;
  sessionContext: SessionContext;
  alertSend?: (msg: string) => Promise<void> | void;
  runtime?: { subagent?: { run?: (opts: unknown) => Promise<unknown> } };
}

export function createBeforeToolCallHandler(deps: BeforeToolCallDeps) {
  const {
    engine,
    auditLogger,
    rateLimiter,
    config,
    sessionContext,
    alertSend,
    runtime,
  } = deps;

  return (
    event: BeforeToolCallEvent,
    ctx: Record<string, unknown>,
  ): BeforeToolCallResult | void => {
    const { toolName, params, toolCallId } = event;
    const sessionKey = (ctx?.sessionKey as string) || "default";

    try {
      const decision = engine.evaluate(
        toolName,
        params,
        (tn, rn, w) => rateLimiter.getCount(tn, rn, w),
      );

      const policy = engine.getPolicy();
      const defaultTimeout = policy?.defaults.approval_timeout ?? 300;
      const defaultTimeoutAction = policy?.defaults.timeout_action ?? "deny";

      // Compute risk score
      const risk: RiskScore = computeRiskScore(
        toolName,
        params,
        config.risk.llmEvalThreshold,
      );

      // Record in session context
      sessionContext.record(sessionKey, {
        toolName,
        params,
        riskScore: risk.score,
        timestamp: new Date().toISOString(),
      });

      // Log decision with risk data
      auditLogger.logDecision({
        timestamp: new Date().toISOString(),
        toolName,
        toolCallId,
        params,
        policyRule: decision.ruleName,
        decision: decision.action,
        severity: decision.severity,
        riskScore: risk.score,
        riskTier: risk.tier,
        riskTags: risk.tags,
      });

      // Fire alert if score exceeds threshold (async, non-blocking)
      if (alertSend && shouldAlert(risk.score, config.alerts)) {
        const dashboardUrl = config.dashboardUrl || "";
        const msg = formatAlert(toolName, params, risk, dashboardUrl);
        // Fire and forget
        sendAlert(msg, alertSend);
      }

      // Queue async LLM evaluation if needed (fire-and-forget, does NOT block)
      if (risk.needsLlmEval && config.risk.llmEnabled && toolCallId) {
        const recentActions = sessionContext.getRecent(sessionKey, 5);
        evaluateWithLlm(
          toolName,
          params,
          recentActions,
          risk,
          runtime,
        ).then((evaluation) => {
          auditLogger.appendEvaluation({
            refToolCallId: toolCallId,
            toolName,
            llmEvaluation: evaluation,
            riskScore: evaluation.adjustedScore,
            riskTier: getTierFromScore(evaluation.adjustedScore),
            riskTags: evaluation.tags,
          });

          // Alert on LLM-adjusted score too (might have been raised above threshold)
          if (
            alertSend &&
            evaluation.adjustedScore > risk.score &&
            shouldAlert(evaluation.adjustedScore, config.alerts)
          ) {
            const adjustedRisk = {
              ...risk,
              score: evaluation.adjustedScore,
              tier: getTierFromScore(evaluation.adjustedScore),
              tags: evaluation.tags,
            } as RiskScore;
            const msg = formatAlert(
              toolName,
              params,
              adjustedRisk,
              config.dashboardUrl || "",
            );
            sendAlert(msg, alertSend);
          }
        });
      }

      switch (decision.action) {
        case "block":
          return {
            block: true,
            blockReason: `ClawLens: ${decision.reason || "Blocked by policy"}`,
          };

        case "approval_required":
          return {
            requireApproval: {
              title: `ClawLens: ${decision.ruleName || "Policy approval"}`,
              description: formatApprovalDescription(toolName, params),
              severity: decision.severity || "warning",
              timeoutMs: (decision.timeout || defaultTimeout) * 1000,
              timeoutBehavior: decision.timeoutAction || defaultTimeoutAction,
              onResolution: (resolution) => {
                auditLogger.logApprovalResolution({
                  toolCallId,
                  toolName,
                  approved: resolution === "allow-once" || resolution === "allow-always",
                  resolvedBy: typeof resolution === "string" ? resolution : undefined,
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
        blockReason: `ClawLens: Internal error — blocked for safety. ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  };
}

function getTierFromScore(score: number): "low" | "medium" | "high" | "critical" {
  if (score >= 80) return "critical";
  if (score >= 60) return "high";
  if (score >= 30) return "medium";
  return "low";
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
      const display = value.length > 200 ? value.slice(0, 200) + "\u2026" : value;
      lines.push(`  ${key}: \`${display}\``);
    }
  }

  return lines.join("\n");
}
