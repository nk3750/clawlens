import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { llmHealthTracker } from "../audit/llm-health";
export const EVAL_SYSTEM_PROMPT = `You are a security analyst evaluating an AI agent's tool call for risk.

Evaluate:
1. Is this action potentially dangerous? (destructive, exfiltration, persistence, scope-creep)
2. Does the sequence of recent actions suggest a concerning pattern?
3. Rate the adjusted risk score (0-100) and confidence.

Respond ONLY with JSON, no explanation outside the JSON:
{
  "adjustedScore": <number 0-100>,
  "reasoning": "<one sentence>",
  "tags": ["<tag1>", "<tag2>"],
  "confidence": "high|medium|low",
  "patterns": ["<pattern1>"]
}`;
// ── Provider maps ───────────────────────────────────────
export const PROVIDER_ENDPOINTS = {
    anthropic: "https://api.anthropic.com",
    openai: "https://api.openai.com",
    groq: "https://api.groq.com/openai",
    together: "https://api.together.xyz",
};
export const DEFAULT_EVAL_MODELS = {
    anthropic: "claude-haiku-4-5-20251001",
    openai: "gpt-4o-mini",
    groq: "llama-3.1-8b-instant",
    together: "meta-llama/Llama-3.1-8B-Instruct-Turbo",
};
// ── Core helpers ────────────────────────────────────────
/**
 * Build the user message for the LLM risk evaluator.
 */
export function buildEvalMessage(toolName, params, recentActions, tier1Score) {
    return JSON.stringify({
        currentAction: { toolName, params },
        recentActions: recentActions.map((a) => ({
            toolName: a.toolName,
            params: a.params,
            riskScore: a.riskScore,
        })),
        preliminaryRiskScore: tier1Score.score,
        preliminaryTier: tier1Score.tier,
        preliminaryTags: tier1Score.tags,
    });
}
/**
 * Parse the LLM's JSON response into a structured evaluation.
 * Returns null if the response can't be parsed.
 */
export function parseEvalResponse(raw) {
    try {
        // Extract JSON from response (LLM may wrap in markdown code blocks)
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch)
            return null;
        const parsed = JSON.parse(jsonMatch[0]);
        if (typeof parsed.adjustedScore !== "number")
            return null;
        if (typeof parsed.reasoning !== "string")
            return null;
        return {
            adjustedScore: Math.max(0, Math.min(100, parsed.adjustedScore)),
            reasoning: parsed.reasoning,
            tags: Array.isArray(parsed.tags) ? parsed.tags : [],
            confidence: ["high", "medium", "low"].includes(parsed.confidence) ? parsed.confidence : "low",
            patterns: Array.isArray(parsed.patterns) ? parsed.patterns : [],
        };
    }
    catch {
        return null;
    }
}
/**
 * Extract text from embedded agent payloads.
 */
export function collectEmbeddedText(payloads) {
    return (payloads ?? [])
        .filter((p) => !p.isError && typeof p.text === "string")
        .map((p) => p.text ?? "")
        .join("\n")
        .trim();
}
/**
 * Provider-agnostic LLM API call via raw fetch().
 *
 * - provider === "anthropic": POST /v1/messages, x-api-key header, Anthropic response format
 * - Everything else: OpenAI-compatible POST /v1/chat/completions, Bearer auth
 *
 * Returns raw text response or null on failure. Callers parse the result.
 */
export async function callLlmApi(provider, apiKey, model, systemPrompt, userMessage, logger, maxTokens = 512) {
    const baseUrl = PROVIDER_ENDPOINTS[provider];
    if (!baseUrl) {
        logger?.warn(`ClawLens: Unknown provider "${provider}", no endpoint mapped`);
        return null;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
        let url;
        let headers;
        let body;
        if (provider === "anthropic") {
            url = `${baseUrl}/v1/messages`;
            headers = {
                "Content-Type": "application/json",
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01",
            };
            body = JSON.stringify({
                model,
                max_tokens: maxTokens,
                system: systemPrompt,
                messages: [{ role: "user", content: userMessage }],
            });
        }
        else {
            // OpenAI-compatible format (openai, groq, together, etc.)
            url = `${baseUrl}/v1/chat/completions`;
            headers = {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
            };
            body = JSON.stringify({
                model,
                max_tokens: maxTokens,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userMessage },
                ],
            });
        }
        const response = await fetch(url, {
            method: "POST",
            headers,
            body,
            signal: controller.signal,
        });
        if (!response.ok) {
            // Read the body so `credit balance too low` / 429 / 5xx messages
            // reach the health tracker for classification.
            let errBody = "";
            try {
                errBody = await response.text();
            }
            catch {
                // ignore — status code still carries enough signal
            }
            const errMsg = `${response.status} ${response.statusText} ${errBody}`.trim();
            llmHealthTracker.recordAttempt(false, errMsg);
            logger?.warn(`ClawLens: LLM API returned ${response.status} ${response.statusText}`);
            return null;
        }
        const data = (await response.json());
        // Extract text from response
        if (provider === "anthropic") {
            // Anthropic: { content: [{ type: "text", text: "..." }] }
            const content = data.content;
            if (!content || !Array.isArray(content)) {
                llmHealthTracker.recordAttempt(false, "anthropic: missing content");
                return null;
            }
            const text = content
                .filter((b) => b.type === "text" && typeof b.text === "string")
                .map((b) => b.text)
                .join("\n");
            llmHealthTracker.recordAttempt(true);
            return text;
        }
        // OpenAI-compatible: { choices: [{ message: { content: "..." } }] }
        const choices = data.choices;
        if (!choices || !Array.isArray(choices) || choices.length === 0) {
            llmHealthTracker.recordAttempt(false, "openai-compat: missing choices");
            return null;
        }
        const msg = choices[0].message;
        if (!msg || typeof msg.content !== "string") {
            llmHealthTracker.recordAttempt(false, "openai-compat: missing message.content");
            return null;
        }
        llmHealthTracker.recordAttempt(true);
        return msg.content;
    }
    catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        llmHealthTracker.recordAttempt(false, errMsg);
        if (errMsg.includes("abort")) {
            logger?.warn("ClawLens: LLM API call timed out (15s)");
        }
        else {
            logger?.warn(`ClawLens: LLM API call failed: ${errMsg}`);
        }
        return null;
    }
    finally {
        clearTimeout(timeout);
    }
}
/**
 * Resolve the model to use for eval calls.
 * Priority: explicit config override → default for provider → undefined (skip).
 */
export function resolveModel(provider, configModel) {
    if (configModel)
        return configModel;
    if (provider && DEFAULT_EVAL_MODELS[provider])
        return DEFAULT_EVAL_MODELS[provider];
    return undefined;
}
// ── Main eval function ──────────────────────────────────
/**
 * Evaluate a tool call with an LLM for deeper risk analysis.
 *
 * Evaluation paths (tried in order):
 *   1. Embedded agent — uses OpenClaw's `runEmbeddedPiAgent`, handles auth internally
 *   2. Direct API via modelAuth — resolves key from OpenClaw's auth system
 *   3. Direct API via explicit env var — optional override, backward compat
 *   4. Stub fallback — returns tier-1 score unchanged
 *
 * This is awaited during `before_tool_call` so the audit entry gets the result.
 */
export async function evaluateWithLlm(toolName, params, recentActions, tier1Score, runtime, logger, directApiConfig, openClawConfig) {
    const message = buildEvalMessage(toolName, params, recentActions, tier1Score);
    const provider = directApiConfig?.provider;
    const model = resolveModel(provider, directApiConfig?.model || undefined);
    // Path 1: Embedded agent (uses OpenClaw's own auth, works everywhere)
    if (runtime?.agent?.runEmbeddedPiAgent) {
        try {
            const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clawlens-eval-"));
            const sessionFile = path.join(tmpDir, "session.json");
            try {
                const result = await runtime.agent.runEmbeddedPiAgent({
                    sessionId: `clawlens:risk-eval:${Date.now()}`,
                    sessionFile,
                    workspaceDir: process.cwd(),
                    config: openClawConfig,
                    prompt: message,
                    extraSystemPrompt: EVAL_SYSTEM_PROMPT,
                    timeoutMs: 15_000,
                    runId: `clawlens-eval-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    provider: provider || undefined,
                    model: model || undefined,
                    disableTools: true,
                    streamParams: { maxTokens: 512 },
                });
                const text = collectEmbeddedText(result.payloads);
                if (text) {
                    const parsed = parseEvalResponse(text);
                    if (parsed) {
                        llmHealthTracker.recordAttempt(true);
                        return parsed;
                    }
                    llmHealthTracker.recordAttempt(false, "embedded-agent: unparseable response");
                    logger?.warn("ClawLens: Embedded agent returned unparseable response, falling through");
                }
                else {
                    llmHealthTracker.recordAttempt(false, "embedded-agent: no text");
                    logger?.warn("ClawLens: Embedded agent returned no text, falling through");
                }
            }
            finally {
                await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => { });
            }
        }
        catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            llmHealthTracker.recordAttempt(false, errMsg);
            logger?.warn(`ClawLens: Embedded agent eval failed: ${errMsg}, falling through to direct API`);
        }
    }
    // Path 2: Direct API via modelAuth-resolved key (fixed: object param, reads .apiKey)
    if (runtime?.modelAuth && provider && model && PROVIDER_ENDPOINTS[provider]) {
        try {
            const auth = await runtime.modelAuth.resolveApiKeyForProvider({
                provider,
                cfg: openClawConfig,
            });
            const apiKey = auth?.apiKey;
            if (!apiKey) {
                logger?.warn("ClawLens: modelAuth resolved no API key, falling through to env var");
            }
            else {
                const text = await callLlmApi(provider, apiKey, model, EVAL_SYSTEM_PROMPT, message, logger);
                if (text) {
                    const result = parseEvalResponse(text);
                    if (result)
                        return result;
                    logger?.warn("ClawLens: modelAuth API returned unparseable response, falling through");
                }
                else {
                    logger?.warn("ClawLens: modelAuth API call returned no result, falling through");
                }
            }
        }
        catch (err) {
            logger?.warn(`ClawLens: modelAuth key resolution failed: ${err instanceof Error ? err.message : String(err)}, falling through to env var`);
        }
    }
    // Path 3: Direct API via explicit env var (backward compat / optional override)
    const envVar = directApiConfig?.apiKeyEnv || "ANTHROPIC_API_KEY";
    const envApiKey = process.env[envVar];
    const envProvider = provider || "anthropic";
    const envModel = model || DEFAULT_EVAL_MODELS[envProvider];
    if (envApiKey && envModel && PROVIDER_ENDPOINTS[envProvider]) {
        const text = await callLlmApi(envProvider, envApiKey, envModel, EVAL_SYSTEM_PROMPT, message, logger);
        if (text) {
            const result = parseEvalResponse(text);
            if (result)
                return result;
            logger?.warn("ClawLens: env var API call returned unparseable response, falling through");
        }
        else {
            logger?.warn("ClawLens: env var API call returned no result, falling through");
        }
    }
    else if (!envApiKey) {
        logger?.warn(`ClawLens: ${envVar} not set, no more eval paths`);
    }
    // Path 4: Stub fallback — returns tier-1 score unchanged
    logger?.warn("ClawLens: All eval paths exhausted, returning stub");
    return fallbackStub(tier1Score);
}
function fallbackStub(tier1Score) {
    return {
        adjustedScore: tier1Score.score,
        reasoning: "Stub evaluation — LLM evaluation unavailable",
        tags: [...tier1Score.tags],
        confidence: "low",
        patterns: [],
    };
}
//# sourceMappingURL=llm-evaluator.js.map