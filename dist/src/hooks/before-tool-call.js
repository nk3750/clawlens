import { formatAlert, sendAlert, shouldAlert } from "../alerts/telegram";
import { extractIdentityKey } from "../guardrails/identity";
import { evaluateWithLlm } from "../risk/llm-evaluator";
import { computeRiskScore } from "../risk/scorer";
export function createBeforeToolCallHandler(deps) {
    const { auditLogger, config, sessionContext, evalCache, alertSend, guardrailStore } = deps;
    return async (event, ctx) => {
        // Read session-scoped deps at call time — may be refreshed between sessions
        const { runtime, provider, logger, openClawConfig } = deps;
        const { toolName, params, toolCallId } = event;
        const sessionKey = ctx?.sessionKey || "default";
        const agentId = ctx?.agentId || "unknown";
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
                                    auditLogger.logGuardrailResolution({
                                        guardrailId: matched.id,
                                        toolCallId,
                                        toolName,
                                        approved: decision === "allow-once" || decision === "allow-always",
                                        decision,
                                    });
                                },
                            },
                        };
                    }
                    // allow_once and allow_hours: fall through to normal scoring path
                }
            }
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
        catch {
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
function formatGuardrailApproval(guardrail, toolName, params) {
    const cmd = typeof params.command === "string"
        ? params.command
        : typeof params.path === "string"
            ? params.path
            : typeof params.url === "string"
                ? params.url
                : "";
    const action = cmd ? `${toolName} — ${cmd}` : toolName;
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
//# sourceMappingURL=before-tool-call.js.map