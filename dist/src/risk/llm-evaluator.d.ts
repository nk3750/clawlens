import type { EmbeddedAgentRuntime, ModelAuth, PluginLogger } from "../types";
import type { SessionAction } from "./session-context";
import type { LlmRiskEvaluation, RiskScore } from "./types";
export declare const EVAL_SYSTEM_PROMPT = "You are a security analyst evaluating an AI agent's tool call for risk.\n\nEvaluate:\n1. Is this action potentially dangerous? (destructive, exfiltration, persistence, scope-creep)\n2. Does the sequence of recent actions suggest a concerning pattern?\n3. Rate the adjusted risk score (0-100) and confidence.\n\nRespond ONLY with JSON, no explanation outside the JSON:\n{\n  \"adjustedScore\": <number 0-100>,\n  \"reasoning\": \"<one sentence>\",\n  \"tags\": [\"<tag1>\", \"<tag2>\"],\n  \"confidence\": \"high|medium|low\",\n  \"patterns\": [\"<pattern1>\"]\n}";
export declare const PROVIDER_ENDPOINTS: Record<string, string>;
export declare const DEFAULT_EVAL_MODELS: Record<string, string>;
/**
 * Build the user message for the LLM risk evaluator.
 */
export declare function buildEvalMessage(toolName: string, params: Record<string, unknown>, recentActions: SessionAction[], tier1Score: RiskScore): string;
/**
 * Parse the LLM's JSON response into a structured evaluation.
 * Returns null if the response can't be parsed.
 */
export declare function parseEvalResponse(raw: string): LlmRiskEvaluation | null;
/**
 * Extract text from embedded agent payloads.
 */
export declare function collectEmbeddedText(payloads?: Array<{
    text?: string;
    isError?: boolean;
}>): string;
/**
 * Provider-agnostic LLM API call via raw fetch().
 *
 * - provider === "anthropic": POST /v1/messages, x-api-key header, Anthropic response format
 * - Everything else: OpenAI-compatible POST /v1/chat/completions, Bearer auth
 *
 * Returns raw text response or null on failure. Callers parse the result.
 */
export declare function callLlmApi(provider: string, apiKey: string, model: string, systemPrompt: string, userMessage: string, logger?: PluginLogger, maxTokens?: number): Promise<string | null>;
/**
 * Resolve the model to use for eval calls.
 * Priority: explicit config override → default for provider → undefined (skip).
 */
export declare function resolveModel(provider?: string, configModel?: string): string | undefined;
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
export declare function evaluateWithLlm(toolName: string, params: Record<string, unknown>, recentActions: SessionAction[], tier1Score: RiskScore, runtime?: {
    agent?: EmbeddedAgentRuntime;
    modelAuth?: ModelAuth;
}, logger?: PluginLogger, directApiConfig?: {
    apiKeyEnv?: string;
    model?: string;
    provider?: string;
}, openClawConfig?: Record<string, unknown>): Promise<LlmRiskEvaluation>;
