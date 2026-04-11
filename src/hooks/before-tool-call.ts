import { formatAlert, sendAlert, shouldAlert } from "../alerts/telegram";
import type { AuditLogger } from "../audit/logger";
import type { ClawLensConfig } from "../config";
import type { EvalCache } from "../risk/eval-cache";
import { evaluateWithLlm } from "../risk/llm-evaluator";
import { computeRiskScore } from "../risk/scorer";
import type { SessionContext } from "../risk/session-context";
import type { RiskScore } from "../risk/types";
import type {
  BeforeToolCallEvent,
  BeforeToolCallResult,
  EmbeddedAgentRuntime,
  ModelAuth,
} from "../types";

export interface BeforeToolCallDeps {
  auditLogger: AuditLogger;
  config: ClawLensConfig;
  sessionContext: SessionContext;
  evalCache?: EvalCache;
  alertSend?: (msg: string) => Promise<void> | void;
  logger?: import("../types").PluginLogger;
  runtime?: {
    agent?: EmbeddedAgentRuntime;
    modelAuth?: ModelAuth;
  };
  provider?: string;
  openClawConfig?: Record<string, unknown>;
}

export function createBeforeToolCallHandler(deps: BeforeToolCallDeps) {
  const { auditLogger, config, sessionContext, evalCache, alertSend } = deps;

  return async (
    event: BeforeToolCallEvent,
    ctx: Record<string, unknown>,
  ): Promise<BeforeToolCallResult | undefined> => {
    // Read session-scoped deps at call time — may be refreshed between sessions
    const { runtime, provider, logger, openClawConfig } = deps;

    const { toolName, params, toolCallId } = event;
    const sessionKey = (ctx?.sessionKey as string) || "default";

    try {
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
        decision: "allow",
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
              openClawConfig,
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

      return;
    } catch {
      // Never block — just log the error and allow through
      auditLogger.logDecision({
        timestamp: new Date().toISOString(),
        toolName,
        toolCallId,
        params,
        decision: "allow",
        severity: "critical",
      });
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
