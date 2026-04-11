import { formatAlert, sendAlert, shouldAlert } from "../alerts/telegram";
import type { AuditLogger } from "../audit/logger";
import type { ClawLensConfig } from "../config";
import { extractIdentityKey } from "../guardrails/identity";
import type { GuardrailStore } from "../guardrails/store";
import type { Guardrail } from "../guardrails/types";
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
  guardrailStore?: GuardrailStore;
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
  const { auditLogger, config, sessionContext, evalCache, alertSend, guardrailStore } = deps;

  return async (
    event: BeforeToolCallEvent,
    ctx: Record<string, unknown>,
  ): Promise<BeforeToolCallResult | undefined> => {
    // Read session-scoped deps at call time — may be refreshed between sessions
    const { runtime, provider, logger, openClawConfig } = deps;

    const { toolName, params, toolCallId } = event;
    const sessionKey = (ctx?.sessionKey as string) || "default";
    const agentId = (ctx?.agentId as string) || "unknown";

    try {
      // ── Guardrail check (before risk scoring) ──────────
      if (guardrailStore) {
        const identityKey = extractIdentityKey(toolName, params);
        const matched = guardrailStore.match(agentId, toolName, identityKey);

        if (matched) {
          auditLogger.logGuardrailMatch({
            timestamp: new Date().toISOString(),
            toolCallId,
            toolName,
            guardrailId: matched.id,
            action: matched.action,
            identityKey,
            agentId,
            sessionKey: sessionKey !== "default" ? sessionKey : undefined,
          });

          if (matched.action.type === "block") {
            return {
              block: true,
              blockReason: `ClawLens guardrail: "${matched.description}" is blocked`,
            };
          }

          if (matched.action.type === "require_approval") {
            return {
              requireApproval: {
                title: "ClawLens Guardrail",
                description: formatGuardrailApproval(matched, toolName, params),
                severity: "warning",
                timeoutMs: 300_000,
                timeoutBehavior: "deny",
                pluginId: "clawlens",
                onResolution: (decision) => {
                  const approved = decision === "allow-once" || decision === "allow-always";

                  let storeAction: "removed" | "unchanged" = "unchanged";
                  if (decision === "allow-always" && guardrailStore) {
                    const removed = guardrailStore.remove(matched.id);
                    if (removed) {
                      storeAction = "removed";
                      logger?.info(
                        `ClawLens: Guardrail ${matched.id} removed (allow-always resolution)`,
                      );
                    }
                  }

                  auditLogger.logGuardrailResolution({
                    guardrailId: matched.id,
                    toolCallId,
                    toolName,
                    approved,
                    decision,
                    storeAction,
                  });
                },
              },
            };
          }
        }
      }

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
    } catch (err) {
      // Never block — just log the error and allow through
      const errMsg = err instanceof Error ? err.message : String(err);
      logger?.warn(`ClawLens: before_tool_call error for ${toolName}: ${errMsg}`);
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

function formatGuardrailApproval(
  guardrail: Guardrail,
  toolName: string,
  params: Record<string, unknown>,
): string {
  const detail = extractApprovalDetail(toolName, params);
  const action = detail ? `${toolName} — ${detail}` : toolName;
  const tier = getTierFromScore(guardrail.riskScore).toUpperCase();
  const date = new Date(guardrail.createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  return [
    `Agent: ${guardrail.agentId ?? "all agents"}`,
    `Action: ${action}`,
    `Risk: ${guardrail.riskScore} ${tier}`,
    `Guardrail: "Require Approval" (added ${date})`,
  ].join("\n");
}

function extractApprovalDetail(toolName: string, params: Record<string, unknown>): string {
  const str = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : "");
  switch (toolName) {
    case "exec":
    case "process":
      return str("command");
    case "read":
    case "write":
    case "edit":
      return str("path") || str("file_path");
    case "web_fetch":
    case "fetch_url":
    case "browser":
      return str("url");
    case "web_search":
    case "search":
    case "memory_search":
      return str("query");
    case "message":
      return str("to") || str("recipient");
    case "sessions_spawn":
      return str("sessionKey") || str("agent");
    case "memory_get":
      return str("key");
    case "cron":
      return str("name");
    case "glob":
    case "grep":
      return str("pattern");
    default:
      return "";
  }
}
