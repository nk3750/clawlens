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
                        const approvalTimeoutMs = 300_000;
                        // Wrapper also called by /api/attention/resolve via store.take().
                        // `pendingApprovalStore.take()` is idempotent / single-winner, so
                        // this remains safe whether Telegram, the dashboard, or OpenClaw's
                        // own timeout fires first.
                        const onResolution = (decision) => {
                            if (toolCallId) {
                                deps.pendingApprovalStore?.take(toolCallId);
                            }
                            const approved = decision === "allow-once" || decision === "allow-always";
                            let storeAction = "unchanged";
                            if (decision === "allow-always" && guardrailStore) {
                                const removed = guardrailStore.remove(matched.id);
                                if (removed) {
                                    storeAction = "removed";
                                    logger?.info(`ClawLens: Guardrail ${matched.id} removed (allow-always resolution)`);
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
                        };
                        if (deps.pendingApprovalStore && toolCallId) {
                            deps.pendingApprovalStore.put({
                                toolCallId,
                                agentId,
                                toolName,
                                stashedAt: Date.now(),
                                timeoutMs: approvalTimeoutMs,
                                resolve: async (decision) => onResolution(decision),
                            });
                        }
                        return {
                            requireApproval: {
                                title: "ClawLens Guardrail",
                                description: formatGuardrailApproval(matched, toolName, params),
                                severity: "warning",
                                timeoutMs: approvalTimeoutMs,
                                timeoutBehavior: "deny",
                                pluginId: "clawlens",
                                onResolution,
                            },
                        };
                    }
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
        catch (err) {
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
function extractApprovalDetail(toolName, params) {
    const str = (key) => (typeof params[key] === "string" ? params[key] : "");
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
//# sourceMappingURL=before-tool-call.js.map