import { formatAlert, sendAlert, shouldAlert } from "../alerts/telegram";
import type { AuditLogger } from "../audit/logger";
import type { ClawLensConfig } from "../config";
import type { PolicyEngine } from "../policy/engine";
import type { RateLimiter } from "../rate/limiter";
import type { EvalCache } from "../risk/eval-cache";
import { evaluateWithLlm } from "../risk/llm-evaluator";
import { computeRiskScore } from "../risk/scorer";
import type { SessionContext } from "../risk/session-context";
import type { RiskScore } from "../risk/types";
import type { BeforeToolCallEvent, BeforeToolCallResult, ModelAuth } from "../types";

export interface BeforeToolCallDeps {
  engine: PolicyEngine;
  auditLogger: AuditLogger;
  rateLimiter: RateLimiter;
  config: ClawLensConfig;
  sessionContext: SessionContext;
  evalCache?: EvalCache;
  alertSend?: (msg: string) => Promise<void> | void;
  logger?: import("../types").PluginLogger;
  runtime?: {
    subagent?: {
      run?: (opts: unknown) => Promise<unknown>;
      waitForRun?: (opts: unknown) => Promise<unknown>;
      getSessionMessages?: (opts: unknown) => Promise<unknown>;
      deleteSession?: (opts: unknown) => Promise<void>;
    };
    modelAuth?: ModelAuth;
  };
  provider?: string;
}

export function createBeforeToolCallHandler(deps: BeforeToolCallDeps) {
  const { engine, auditLogger, rateLimiter, config, sessionContext, evalCache, alertSend } = deps;

  return async (
    event: BeforeToolCallEvent,
    ctx: Record<string, unknown>,
  ): Promise<BeforeToolCallResult | undefined> => {
    // Read session-scoped deps at call time — may be refreshed between sessions
    const { runtime, provider, logger } = deps;

    const { toolName, params, toolCallId } = event;
    const sessionKey = (ctx?.sessionKey as string) || "default";

    try {
      // Evaluate policy (for logging what *would* happen, even in observe mode)
      const decision = engine.evaluate(toolName, params, (tn, rn, w) =>
        rateLimiter.getCount(tn, rn, w),
      );

      const policy = engine.getPolicy();
      const defaultTimeout = policy?.defaults.approval_timeout ?? 300;
      const defaultTimeoutAction = policy?.defaults.timeout_action ?? "deny";

      // Compute risk score
      const risk: RiskScore = computeRiskScore(toolName, params, config.risk.llmEvalThreshold);

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
        agentId: ctx?.agentId as string | undefined,
        sessionKey: sessionKey !== "default" ? sessionKey : undefined,
      });

      // Fire alert if score exceeds threshold (async, non-blocking)
      if (alertSend && shouldAlert(risk.score, config.alerts)) {
        const dashboardUrl = config.dashboardUrl || "";
        const msg = formatAlert(toolName, params, risk, dashboardUrl);
        sendAlert(msg, alertSend);
      }

      // Queue async LLM evaluation if needed (fire-and-forget, does NOT block)
      if (risk.needsLlmEval && config.risk.llmEnabled && toolCallId) {
        // Check eval cache first — skip LLM if this pattern was already evaluated
        const cached = evalCache?.get(toolName, params);
        if (cached) {
          auditLogger.appendEvaluation({
            refToolCallId: toolCallId,
            toolName,
            llmEvaluation: {
              adjustedScore: cached.adjustedScore,
              reasoning: `${cached.reasoning} (cached)`,
              tags: cached.tags,
              confidence: "high",
              patterns: [],
            },
            riskScore: cached.adjustedScore,
            riskTier: getTierFromScore(cached.adjustedScore) as
              | "low"
              | "medium"
              | "high"
              | "critical",
            riskTags: cached.tags,
          });
        } else {
          const recentActions = sessionContext.getRecent(sessionKey, 5);
          try {
            const evaluation = await evaluateWithLlm(
              toolName,
              params,
              recentActions,
              risk,
              runtime,
              logger,
              {
                apiKeyEnv: config.risk.llmApiKeyEnv,
                model: config.risk.llmModel,
                provider,
              },
            );

            // For stub evaluations, write a minimal entry so the dashboard
            // can show "AI assessment unavailable" rather than nothing
            if (evaluation.reasoning?.includes("Stub evaluation")) {
              auditLogger.appendEvaluation({
                refToolCallId: toolCallId,
                toolName,
                llmEvaluation: {
                  adjustedScore: risk.score,
                  reasoning: "LLM evaluation unavailable",
                  tags: risk.tags,
                  confidence: "none" as string,
                  patterns: [],
                },
                riskScore: risk.score,
                riskTier: getTierFromScore(risk.score),
                riskTags: risk.tags,
              });
            } else {
              auditLogger.appendEvaluation({
                refToolCallId: toolCallId,
                toolName,
                llmEvaluation: evaluation,
                riskScore: evaluation.adjustedScore,
                riskTier: getTierFromScore(evaluation.adjustedScore),
                riskTags: evaluation.tags,
              });

              // Cache high-confidence low-risk evaluations for future use
              evalCache?.maybeCache(toolName, params, evaluation, config.risk.llmEvalThreshold);

              // Alert on LLM-adjusted score if it was raised above threshold
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
                const msg = formatAlert(toolName, params, adjustedRisk, config.dashboardUrl || "");
                sendAlert(msg, alertSend);
              }
            }
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            logger?.warn(`ClawLens: LLM eval failed for ${toolName}: ${errMsg}`);
            try {
              auditLogger.appendEvaluation({
                refToolCallId: toolCallId,
                toolName,
                llmEvaluation: {
                  adjustedScore: risk.score,
                  reasoning: `LLM evaluation failed: ${errMsg}`,
                  tags: risk.tags,
                  confidence: "none" as string,
                  patterns: [],
                },
                riskScore: risk.score,
                riskTier: getTierFromScore(risk.score),
                riskTags: risk.tags,
              });
            } catch {
              // Last resort — don't let audit write failure crash the process
            }
          }
        }
      }

      // Record for rate limiting (always, for tracking)
      rateLimiter.record(toolName, decision.ruleName);

      // ── Mode: observe (default) ──────────────────────────────
      // Score, log, alert — but never block. Always return void.
      if (config.mode === "observe") {
        return;
      }

      // ── Mode: enforce ────────────────────────────────────────
      // Apply policy decisions: block or require approval.
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
        default:
          return;
      }
    } catch (err) {
      // In observe mode, never block — just log the error
      auditLogger.logDecision({
        timestamp: new Date().toISOString(),
        toolName,
        toolCallId,
        params,
        decision: config.mode === "enforce" ? "block" : "allow",
        severity: "critical",
      });

      if (config.mode === "enforce") {
        return {
          block: true,
          blockReason: `ClawLens: Internal error — blocked for safety. ${err instanceof Error ? err.message : String(err)}`,
        };
      }
      // observe mode: log error, allow through
      return;
    }
  };
}

function getTierFromScore(score: number): "low" | "medium" | "high" | "critical" {
  if (score >= 80) return "critical";
  if (score >= 60) return "high";
  if (score >= 30) return "medium";
  return "low";
}

function formatApprovalDescription(toolName: string, params: Record<string, unknown>): string {
  const lines: string[] = [`The agent wants to use **${toolName}**`];

  const interesting = ["command", "path", "url", "to", "content", "name"];
  for (const key of interesting) {
    if (params[key] !== undefined) {
      const value = String(params[key]);
      const display = value.length > 200 ? `${value.slice(0, 200)}\u2026` : value;
      lines.push(`  ${key}: \`${display}\``);
    }
  }

  return lines.join("\n");
}
