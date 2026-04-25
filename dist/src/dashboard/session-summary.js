import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { llmHealthTracker } from "../audit/llm-health";
import { callLlmApi, collectEmbeddedText, DEFAULT_EVAL_MODELS, PROVIDER_ENDPOINTS, } from "../risk/llm-evaluator";
import { describeAction } from "./categories";
/** Build index of eval entries keyed by the toolCallId they reference. */
function buildEvalIndex(entries) {
    const index = new Map();
    for (const e of entries) {
        if (e.refToolCallId && e.llmEvaluation) {
            index.set(e.refToolCallId, e);
        }
    }
    return index;
}
/** Get the effective risk score, preferring LLM-adjusted over Tier 1. */
function getEffectiveScore(entry, evalIdx) {
    if (entry.toolCallId) {
        const evalEntry = evalIdx.get(entry.toolCallId);
        if (evalEntry?.llmEvaluation)
            return evalEntry.llmEvaluation.adjustedScore;
    }
    if (entry.llmEvaluation)
        return entry.llmEvaluation.adjustedScore;
    return entry.riskScore;
}
const summaryCache = new Map();
const ACTIVE_SESSION_TTL_MS = 60_000; // 60s for active sessions
/**
 * Check if a session appears to still be active (last entry within 5 min).
 */
function isSessionActive(entries) {
    if (entries.length === 0)
        return false;
    let latest = entries[0].timestamp;
    for (const e of entries) {
        if (e.timestamp > latest)
            latest = e.timestamp;
    }
    return Date.now() - new Date(latest).getTime() < 5 * 60 * 1000;
}
/**
 * Generate a template summary for sessions with few entries.
 */
function templateSummary(sessionKey, entries, evalIdx) {
    const decisions = entries.filter((e) => e.decision !== undefined);
    const count = decisions.length;
    // Avg risk using LLM-adjusted scores
    let riskSum = 0;
    let riskCount = 0;
    for (const e of entries) {
        const score = getEffectiveScore(e, evalIdx);
        if (score !== undefined) {
            riskSum += score;
            riskCount++;
        }
    }
    const avgRisk = riskCount > 0 ? Math.round(riskSum / riskCount) : 0;
    return {
        sessionKey,
        summary: `Ran ${count} action${count !== 1 ? "s" : ""}. Avg risk: ${avgRisk}.`,
        generatedAt: new Date().toISOString(),
        isLlmGenerated: false,
    };
}
/**
 * Build the LLM prompt for session summarization.
 */
function buildSummaryPrompt(sessionKey, entries, evalIdx) {
    const decisions = entries
        .filter((e) => e.decision !== undefined)
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const startTime = decisions[0]?.timestamp ?? "unknown";
    const endTime = decisions[decisions.length - 1]?.timestamp ?? "unknown";
    const startMs = new Date(startTime).getTime();
    const endMs = new Date(endTime).getTime();
    const durationMs = endMs - startMs;
    const durationStr = durationMs > 60000 ? `${Math.round(durationMs / 60000)}m` : `${Math.round(durationMs / 1000)}s`;
    let riskSum = 0;
    let riskCount = 0;
    let peakRisk = 0;
    for (const e of entries) {
        const score = getEffectiveScore(e, evalIdx);
        if (score !== undefined) {
            riskSum += score;
            riskCount++;
            if (score > peakRisk)
                peakRisk = score;
        }
    }
    const avgRisk = riskCount > 0 ? Math.round(riskSum / riskCount) : 0;
    const toolLines = decisions
        .slice(0, 30)
        .map((e) => {
        const desc = describeAction(e);
        const score = getEffectiveScore(e, evalIdx);
        const risk = score !== undefined && score >= 30 ? ` (risk ${score})` : "";
        return `- ${e.toolName}: ${desc}${risk}`;
    })
        .join("\n");
    // Highlight risky actions separately so the LLM notices them
    const riskyActions = decisions
        .filter((e) => {
        const score = getEffectiveScore(e, evalIdx);
        return score !== undefined && score >= 50;
    })
        .slice(0, 5)
        .map((e) => {
        const desc = describeAction(e);
        const score = getEffectiveScore(e, evalIdx);
        return `- ${desc} (risk ${score})`;
    })
        .join("\n");
    const riskySection = riskyActions ? `\n\nElevated risk actions:\n${riskyActions}` : "";
    return `Describe this agent's activity pattern in one present-tense sentence (≤140 characters).

Session: ${sessionKey}
Duration: ${durationStr}
Actions: ${decisions.length}
Avg risk: ${avgRisk}, Peak: ${peakRisk}

Tool calls:
${toolLines}${riskySection}`;
}
/**
 * Content-shaped summary cap. Prefer cutting at the last sentence terminator
 * (`.`, `!`, `?`) so the popover lands on a complete thought. Fall back to a
 * word-boundary char-cap with `…` only when there's no usable terminator AND
 * the raw response runs past `max` (panic-stop, ~400 chars). The 40-char guard
 * on the terminator cut prevents a leading "Yes." from chopping the rest of
 * the response.
 *
 * Exported for direct unit-testing — internal helper otherwise.
 */
export function capSummaryLength(raw, max = 400) {
    // Search BACKWARD from end: the last terminator gives the longest valid
    // sentence-cap. If it fails the 40-char guard, all earlier terminators
    // produce shorter slices that also fail — so we can stop.
    for (let i = raw.length - 1; i >= 0; i--) {
        const ch = raw[i];
        if (ch === "." || ch === "!" || ch === "?") {
            if (i + 1 >= 40)
                return raw.slice(0, i + 1);
            break;
        }
    }
    if (raw.length <= max)
        return raw;
    const cut = raw.slice(0, max);
    const lastSpace = cut.lastIndexOf(" ");
    const boundary = lastSpace > max - 30 ? lastSpace : max;
    return `${cut.slice(0, boundary).trimEnd()}…`;
}
/**
 * Get or generate a session summary.
 *
 * Returns `{ ok: true, summary }` for any session with entries — either the
 * LLM-generated summary or the template fallback. Returns
 * `{ ok: false, reason: "not_found", ... }` when the session key has no
 * entries. Never throws; the HTTP layer branches on `result.ok`.
 */
export async function getSessionSummary(sessionKey, entries, config) {
    let sessionEntries = entries.filter((e) => e.sessionKey === sessionKey);
    // Handle split session keys (e.g., "agent:bot:cron:job#2")
    if (sessionEntries.length === 0) {
        const hashIdx = sessionKey.lastIndexOf("#");
        if (hashIdx !== -1) {
            const baseKey = sessionKey.slice(0, hashIdx);
            const runNum = parseInt(sessionKey.slice(hashIdx + 1), 10);
            const baseEntries = entries
                .filter((e) => e.sessionKey === baseKey)
                .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
            // Split by 30-min gaps and pick the right run
            const GAP_MS = 30 * 60 * 1000;
            const runs = [];
            let current = [];
            for (const e of baseEntries) {
                if (current.length > 0) {
                    const gap = new Date(e.timestamp).getTime() -
                        new Date(current[current.length - 1].timestamp).getTime();
                    if (gap > GAP_MS) {
                        runs.push(current);
                        current = [];
                    }
                }
                current.push(e);
            }
            if (current.length > 0)
                runs.push(current);
            sessionEntries = runs[runNum - 1] ?? [];
        }
    }
    if (sessionEntries.length === 0) {
        return {
            ok: false,
            reason: "not_found",
            message: `No entries for sessionKey ${sessionKey}`,
        };
    }
    // Check cache
    const cached = summaryCache.get(sessionKey);
    if (cached) {
        if (cached.expiresAt === null || Date.now() < cached.expiresAt) {
            return { ok: true, summary: cached.summary };
        }
        // Expired — remove and regenerate
        summaryCache.delete(sessionKey);
    }
    // Build eval index from ALL entries — eval entries may not share the session key
    const evalIdx = buildEvalIndex(entries);
    const decisions = sessionEntries.filter((e) => e.decision !== undefined);
    const active = isSessionActive(sessionEntries);
    let summary;
    if (decisions.length < 3) {
        summary = templateSummary(sessionKey, sessionEntries, evalIdx);
    }
    else {
        // Try LLM generation
        const llmSummary = await generateLlmSummary(sessionKey, sessionEntries, config, evalIdx);
        summary = llmSummary ?? templateSummary(sessionKey, sessionEntries, evalIdx);
    }
    // Cache: permanent for ended sessions, TTL for active
    summaryCache.set(sessionKey, {
        summary,
        expiresAt: active ? Date.now() + ACTIVE_SESSION_TTL_MS : null,
    });
    return { ok: true, summary };
}
async function generateLlmSummary(sessionKey, entries, config, evalIdx) {
    const prompt = buildSummaryPrompt(sessionKey, entries, evalIdx);
    const provider = config.provider || "anthropic";
    const model = config.llmModel || DEFAULT_EVAL_MODELS[provider];
    // Need a known provider and a model to proceed (for direct API paths)
    const needsDirectApi = model && PROVIDER_ENDPOINTS[provider];
    const systemPrompt = [
        "Describe what this agent has been up to in ONE plain-text sentence.",
        "Present tense. Pattern-focused, not event-by-event.",
        "Aim for ≤200 characters in one sentence — a complete thought matters more than the count. No markdown, no bullets, no follow-up.",
        "If any actions had elevated risk, briefly note them in the same sentence.",
        "Do not mention policy decisions, approvals, or blocking.",
        "Output the sentence directly. Nothing else.",
    ].join(" ");
    // Path 1: Embedded agent (handles auth internally)
    if (config.agent?.runEmbeddedPiAgent) {
        try {
            const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clawlens-summary-"));
            const sessionFile = path.join(tmpDir, "session.json");
            try {
                const result = await config.agent.runEmbeddedPiAgent({
                    sessionId: `clawlens:summary:${Date.now()}`,
                    sessionFile,
                    workspaceDir: process.cwd(),
                    config: config.openClawConfig,
                    prompt,
                    extraSystemPrompt: systemPrompt,
                    timeoutMs: 15_000,
                    runId: `clawlens-summary-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    provider: provider || undefined,
                    model: model || undefined,
                    disableTools: true,
                    streamParams: { maxTokens: 100 },
                });
                const text = collectEmbeddedText(result.payloads);
                if (text) {
                    llmHealthTracker.recordAttempt(true);
                    return {
                        sessionKey,
                        summary: capSummaryLength(stripMarkdown(text)),
                        generatedAt: new Date().toISOString(),
                        isLlmGenerated: true,
                    };
                }
                llmHealthTracker.recordAttempt(false, "embedded-agent: no text");
            }
            finally {
                await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => { });
            }
        }
        catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            llmHealthTracker.recordAttempt(false, errMsg);
            // Fall through to direct API paths
        }
    }
    if (!needsDirectApi)
        return null;
    // Resolve API key: modelAuth first, then env var
    let apiKey;
    // Path 2: modelAuth-resolved key (fixed: object param, reads .apiKey)
    if (config.modelAuth && config.provider) {
        try {
            const auth = await config.modelAuth.resolveApiKeyForProvider({
                provider: config.provider,
                cfg: config.openClawConfig,
            });
            apiKey = auth?.apiKey;
        }
        catch {
            // Fall through to env var
        }
    }
    // Path 3: explicit env var
    if (!apiKey) {
        apiKey = process.env[config.llmApiKeyEnv];
    }
    if (!apiKey)
        return null;
    // Summary path: cap upstream tokens at ~100 — enough headroom for the soft
    // ≤200-char target to land on a sentence terminator instead of running into
    // the upstream cap mid-word. Eval path's default of 512 is preserved by the
    // optional-arg signature.
    const text = await callLlmApi(provider, apiKey, model, systemPrompt, prompt, undefined, 100);
    if (!text)
        return null;
    return {
        sessionKey,
        summary: capSummaryLength(stripMarkdown(text)),
        generatedAt: new Date().toISOString(),
        isLlmGenerated: true,
    };
}
/**
 * Strip markdown artifacts that LLMs may include despite instructions.
 * Returns clean plain text suitable for inline display.
 */
function stripMarkdown(raw) {
    return raw
        .replace(/^#+\s+.*/gm, "") // remove headers
        .replace(/\*\*([^*]+)\*\*/g, "$1") // bold → plain
        .replace(/\*([^*]+)\*/g, "$1") // italic → plain
        .replace(/^[-*]\s+/gm, "") // remove bullet points
        .replace(/^---+$/gm, "") // remove horizontal rules
        .replace(/`([^`]+)`/g, "$1") // inline code → plain
        .replace(/\n{2,}/g, " ") // collapse double newlines
        .replace(/\n/g, " ") // remaining newlines → spaces
        .replace(/\s{2,}/g, " ") // collapse whitespace
        .trim();
}
/** Exposed for testing — clears the summary cache. */
export function clearSummaryCache() {
    summaryCache.clear();
}
/** Exposed for testing — get cache size. */
export function getSummaryCacheSize() {
    return summaryCache.size;
}
//# sourceMappingURL=session-summary.js.map