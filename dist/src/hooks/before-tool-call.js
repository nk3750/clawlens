import { formatAlert, formatGuardrailNotifyAlert, sendAlert, shouldAlert, } from "../alerts/alert-format.js";
import { formatTargetSummary } from "../dashboard/categories.js";
import { extractIdentityKey } from "../guardrails/identity.js";
import { redactParams } from "../privacy/redaction.js";
import { evaluateWithLlm } from "../risk/llm-evaluator.js";
import { computeRiskScore } from "../risk/scorer.js";
export function createBeforeToolCallHandler(deps) {
    const { auditLogger, config, sessionContext, evalCache, alertSend, guardrailStore } = deps;
    return async (event, ctx) => {
        // Read session-scoped deps at call time — may be refreshed between sessions
        const { runtime, provider, logger, openClawConfig } = deps;
        const { toolName, params, toolCallId } = event;
        const sessionKey = ctx?.sessionKey || "default";
        const agentId = ctx?.agentId || "unknown";
        try {
            // Compute risk score eagerly on RAW params. Pure + fast (no LLM); the
            // local scorer needs full context (e.g. detecting `Authorization: Bearer`
            // in an exec command) and stays in-process. Sanitized params are derived
            // once below and used everywhere that crosses a trust boundary
            // (audit, session context, LLM payload, alerts, approval text) — see
            // spec §2A.
            const risk = computeRiskScore(toolName, params, config.risk.llmEvalThreshold);
            const sanitizedParams = redactParams(params);
            // ── Guardrail check (before risk scoring) ──────────
            // Guardrail matching also reads raw params: a user-created rule may
            // match on `Authorization: Bearer` patterns or token-like values, and
            // matching on the sanitized form would defeat the rule.
            if (guardrailStore) {
                const matched = guardrailStore.match(agentId, toolName, params);
                if (matched) {
                    const identityKey = extractIdentityKey(toolName, params);
                    const targetSummary = formatTargetSummary(matched.target);
                    auditLogger.logGuardrailMatch({
                        timestamp: new Date().toISOString(),
                        toolCallId,
                        toolName,
                        guardrailId: matched.id,
                        action: matched.action,
                        identityKey,
                        targetSummary,
                        agentId,
                        sessionKey: sessionKey !== "default" ? sessionKey : undefined,
                        riskScore: risk.score,
                        riskTier: risk.tier,
                        riskTags: risk.tags,
                    });
                    if (matched.action === "block") {
                        return {
                            block: true,
                            blockReason: `ClawLens guardrail: "${matched.description}" is blocked`,
                        };
                    }
                    if (matched.action === "require_approval") {
                        const approvalTimeoutMs = 300_000;
                        // Wrapper called by /api/attention/resolve via store.take(). Until
                        // OpenClaw exposes a plugin-side resolver (openclaw/openclaw#68626),
                        // this only cleans our stash + writes the guardrail-resolution audit
                        // row — it does NOT actually unblock the tool call. Telegram /
                        // timeout remain the only real resolution paths today.
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
                                agentId: ctx?.agentId,
                                sessionKey: sessionKey !== "default" ? sessionKey : undefined,
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
                                description: formatGuardrailApproval(matched, toolName, sanitizedParams),
                                severity: "warning",
                                timeoutMs: approvalTimeoutMs,
                                timeoutBehavior: "deny",
                                pluginId: "clawlens",
                                onResolution,
                            },
                        };
                    }
                    if (matched.action === "allow_notify") {
                        // Audit + alert, then fall through to the normal allow path
                        // (risk + LLM eval + decision audit row). Operators get a
                        // distinct firing on the dashboard via the audit row's
                        // action="allow_notify" tag plus the alert log line.
                        if (alertSend) {
                            const msg = formatGuardrailNotifyAlert(matched, toolName, sanitizedParams, {
                                includeParamValues: config.alerts.includeParamValues,
                            });
                            sendAlert(msg, alertSend);
                        }
                    }
                }
            }
            // Record in session context with sanitized params so recent-action
            // context replayed into future LLM prompts never carries raw secrets.
            sessionContext.record(sessionKey, {
                toolName,
                params: sanitizedParams,
                riskScore: risk.score,
                timestamp: new Date().toISOString(),
            });
            // Persist sanitized params to the audit log.
            auditLogger.logDecision({
                timestamp: new Date().toISOString(),
                toolName,
                toolCallId,
                params: sanitizedParams,
                decision: "allow",
                riskScore: risk.score,
                riskTier: risk.tier,
                riskTags: risk.tags,
                agentId: ctx?.agentId,
                sessionKey: sessionKey !== "default" ? sessionKey : undefined,
            });
            // Fire alert if score exceeds threshold (async, non-blocking).
            // Alert formatter defaults to a redacted summary; opt-in full-value
            // detail goes through alerts.includeParamValues and only ever sees the
            // sanitized params.
            if (alertSend && shouldAlert(risk.score, config.alerts)) {
                const dashboardUrl = config.dashboardUrl || "";
                const msg = formatAlert(toolName, sanitizedParams, risk, dashboardUrl, {
                    includeParamValues: config.alerts.includeParamValues,
                });
                sendAlert(msg, alertSend);
            }
            // Queue async LLM evaluation if needed (fire-and-forget, does NOT block)
            if (risk.needsLlmEval && config.risk.llmEnabled && toolCallId) {
                // Check eval cache using sanitized params so cache keys are stable
                // across raw vs redacted hashing.
                const cached = evalCache?.get(toolName, sanitizedParams);
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
                        agentId: ctx?.agentId,
                        sessionKey: sessionKey !== "default" ? sessionKey : undefined,
                    });
                }
                else {
                    // recentActions already carries sanitized params (we stored them
                    // sanitized above). LLM payload therefore never sees raw secrets.
                    const recentActions = sessionContext.getRecent(sessionKey, 5);
                    try {
                        const evaluation = await evaluateWithLlm(toolName, sanitizedParams, recentActions, risk, runtime, logger, { provider }, openClawConfig);
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
                                agentId: ctx?.agentId,
                                sessionKey: sessionKey !== "default" ? sessionKey : undefined,
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
                                agentId: ctx?.agentId,
                                sessionKey: sessionKey !== "default" ? sessionKey : undefined,
                            });
                            // Cache high-confidence low-risk evaluations for future use.
                            evalCache?.maybeCache(toolName, sanitizedParams, evaluation, config.risk.llmEvalThreshold);
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
                                const msg = formatAlert(toolName, sanitizedParams, adjustedRisk, config.dashboardUrl || "", { includeParamValues: config.alerts.includeParamValues });
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
                                agentId: ctx?.agentId,
                                sessionKey: sessionKey !== "default" ? sessionKey : undefined,
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
                // Sanitize params on the error path too — failure here must not
                // leak credentials into the audit log.
                params: redactParams(params),
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
        `Agent: ${guardrail.selector.agent ?? "all agents"}`,
        `Action: ${action}`,
        `Risk: ${guardrail.riskScore} ${tier}`,
        `Guardrail: "Require Approval" (added ${date})`,
    ].join("\n");
}
export function extractApprovalDetail(toolName, params) {
    const str = (key) => (typeof params[key] === "string" ? params[key] : "");
    switch (toolName) {
        case "exec":
            return str("command");
        case "process": {
            // Live params: {action, sessionId, ...} — no command. See issue #43.
            const action = str("action");
            const sessionId = str("sessionId");
            if (!action && !sessionId)
                return "";
            return `${action}:${sessionId}`;
        }
        case "read":
        case "write":
        case "edit":
            return str("path") || str("file_path");
        case "ls":
            return str("path");
        case "web_fetch":
        case "fetch_url":
        case "browser":
            return str("url");
        case "web_search":
        case "memory_search":
            return str("query");
        case "message": {
            // Live params: {action, target, channel, ...} — no `to` or `recipient`.
            // target wins over channel. See issue #43.
            const action = str("action");
            const target = str("target");
            const channel = str("channel");
            if (!action && !target && !channel)
                return "";
            return `${action}:${target || channel}`;
        }
        case "sessions_spawn":
            return str("sessionKey") || str("agent");
        case "memory_get":
            return str("key");
        case "cron":
            return str("name");
        case "find":
        case "grep":
            // pi-coding-agent registers `find` (not `glob`) with a `pattern` param.
            // See issue #47.
            return str("pattern");
        default:
            return "";
    }
}
//# sourceMappingURL=before-tool-call.js.map