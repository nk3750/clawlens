import { formatAlert, sendAlert, shouldAlert } from "../alerts/telegram";
import { evaluateWithLlm } from "../risk/llm-evaluator";
import { computeRiskScore } from "../risk/scorer";
export function createBeforeToolCallHandler(deps) {
    const { auditLogger, config, sessionContext, evalCache, alertSend } = deps;
    return async (event, ctx) => {
        // Read session-scoped deps at call time — may be refreshed between sessions
        const { runtime, provider, logger, openClawConfig } = deps;
        const { toolName, params, toolCallId } = event;
        const sessionKey = ctx?.sessionKey || "default";
        try {
            // Compute risk score
            const risk = computeRiskScore(toolName, params, config.risk.llmEvalThreshold);
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
                agentId: ctx?.agentId,
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
                        riskTier: getTierFromScore(cached.adjustedScore),
                        riskTags: cached.tags,
                    });
                }
                else {
                    const recentActions = sessionContext.getRecent(sessionKey, 5);
                    try {
                        const evaluation = await evaluateWithLlm(toolName, params, recentActions, risk, runtime, logger, {
                            apiKeyEnv: config.risk.llmApiKeyEnv,
                            model: config.risk.llmModel,
                            provider,
                        }, openClawConfig);
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
                                    confidence: "none",
                                    patterns: [],
                                },
                                riskScore: risk.score,
                                riskTier: getTierFromScore(risk.score),
                                riskTags: risk.tags,
                            });
                        }
                        else {
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
                            if (alertSend &&
                                evaluation.adjustedScore > risk.score &&
                                shouldAlert(evaluation.adjustedScore, config.alerts)) {
                                const adjustedRisk = {
                                    ...risk,
                                    score: evaluation.adjustedScore,
                                    tier: getTierFromScore(evaluation.adjustedScore),
                                    tags: evaluation.tags,
                                };
                                const msg = formatAlert(toolName, params, adjustedRisk, config.dashboardUrl || "");
                                sendAlert(msg, alertSend);
                            }
                        }
                    }
                    catch (err) {
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
                                    confidence: "none",
                                    patterns: [],
                                },
                                riskScore: risk.score,
                                riskTier: getTierFromScore(risk.score),
                                riskTags: risk.tags,
                            });
                        }
                        catch {
                            // Last resort — don't let audit write failure crash the process
                        }
                    }
                }
            }
            return;
        }
        catch (err) {
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
function getTierFromScore(score) {
    if (score >= 80)
        return "critical";
    if (score >= 60)
        return "high";
    if (score >= 30)
        return "medium";
    return "low";
}
//# sourceMappingURL=before-tool-call.js.map