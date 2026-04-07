import type { ModelAuth, PluginLogger } from "../types";
import type { SessionAction } from "./session-context";
import type { LlmRiskEvaluation, RiskScore } from "./types";

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

/**
 * Build the user message for the LLM risk evaluator.
 */
export function buildEvalMessage(
  toolName: string,
  params: Record<string, unknown>,
  recentActions: SessionAction[],
  tier1Score: RiskScore,
): string {
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
export function parseEvalResponse(raw: string): LlmRiskEvaluation | null {
  try {
    // Extract JSON from response (LLM may wrap in markdown code blocks)
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);

    if (typeof parsed.adjustedScore !== "number") return null;
    if (typeof parsed.reasoning !== "string") return null;

    return {
      adjustedScore: Math.max(0, Math.min(100, parsed.adjustedScore)),
      reasoning: parsed.reasoning,
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      confidence: ["high", "medium", "low"].includes(parsed.confidence) ? parsed.confidence : "low",
      patterns: Array.isArray(parsed.patterns) ? parsed.patterns : [],
    };
  } catch {
    return null;
  }
}

/**
 * Shared helper: call the Anthropic API with a given key and return parsed eval.
 * Returns null if the call fails or the response can't be parsed.
 */
export async function callAnthropicApi(
  apiKey: string,
  model: string,
  message: string,
  logger?: PluginLogger,
): Promise<LlmRiskEvaluation | null> {
  try {
    // Dynamic import to avoid hard failure if SDK not installed
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });

    const response = await Promise.race([
      client.messages.create({
        model,
        max_tokens: 512,
        system: EVAL_SYSTEM_PROMPT,
        messages: [{ role: "user", content: message }],
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Direct API timeout (15s)")), 15_000),
      ),
    ]);

    // Extract text from response
    const textBlocks = response.content.filter(
      (b): b is { type: "text"; text: string } => b.type === "text",
    );
    const raw = textBlocks.map((b) => b.text).join("\n");

    const parsed = parseEvalResponse(raw);
    if (parsed) {
      return parsed;
    }

    logger?.warn("ClawLens: Direct API returned unparseable response");
    return null;
  } catch (err) {
    logger?.warn(
      `ClawLens: Direct API eval failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/**
 * Evaluate a tool call with an LLM for deeper risk analysis.
 *
 * Evaluation paths (tried in order):
 *   1. Direct API via modelAuth — resolves key from OpenClaw's auth system (works everywhere)
 *   2. Direct API via explicit env var — optional override, backward compat
 *   3. runtime.subagent — best-effort, works during gateway request batch only
 *   4. Stub fallback — returns tier-1 score unchanged
 *
 * This is fire-and-forget. It does NOT block the tool call.
 * The result updates the audit entry after the fact.
 */
export async function evaluateWithLlm(
  toolName: string,
  params: Record<string, unknown>,
  recentActions: SessionAction[],
  tier1Score: RiskScore,
  runtime?: {
    subagent?: {
      run?: (opts: unknown) => Promise<unknown>;
      waitForRun?: (opts: unknown) => Promise<unknown>;
      getSessionMessages?: (opts: unknown) => Promise<unknown>;
      deleteSession?: (opts: unknown) => Promise<void>;
    };
    modelAuth?: ModelAuth;
  },
  logger?: PluginLogger,
  directApiConfig?: {
    apiKeyEnv?: string;
    model?: string;
    provider?: string;
  },
): Promise<LlmRiskEvaluation> {
  const message = buildEvalMessage(toolName, params, recentActions, tier1Score);
  const model = directApiConfig?.model || "claude-haiku-4-5-20251001";

  // Path 1: Direct API via modelAuth-resolved key (works everywhere, any point in the turn)
  if (runtime?.modelAuth && directApiConfig?.provider) {
    try {
      const apiKey = await runtime.modelAuth.resolveApiKeyForProvider(directApiConfig.provider);
      const result = await callAnthropicApi(apiKey, model, message, logger);
      if (result) return result;
      logger?.warn("ClawLens: modelAuth API call returned no result, falling through");
    } catch (err) {
      logger?.warn(
        `ClawLens: modelAuth key resolution failed: ${err instanceof Error ? err.message : String(err)}, falling through to env var`,
      );
    }
  }

  // Path 2: Direct API via explicit env var (backward compat / optional override)
  const envVar = directApiConfig?.apiKeyEnv || "ANTHROPIC_API_KEY";
  const envApiKey = process.env[envVar];
  if (envApiKey) {
    const result = await callAnthropicApi(envApiKey, model, message, logger);
    if (result) return result;
    logger?.warn("ClawLens: env var API call returned no result, falling through to subagent");
  } else {
    logger?.warn(`ClawLens: ${envVar} not set, falling through to subagent`);
  }

  // Path 3: Subagent (best-effort, entire block in try — fixes P0 bug)
  try {
    const subagent = runtime?.subagent;
    if (subagent?.run && subagent?.waitForRun && subagent?.getSessionMessages) {
      const sessionKey = `clawlens:risk-eval:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

      // 1. Spawn subagent
      const idempotencyKey = `clawlens:eval:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
      const runResult = (await subagent.run({
        sessionKey,
        message,
        extraSystemPrompt: EVAL_SYSTEM_PROMPT,
        idempotencyKey,
      })) as { runId: string };

      // 2. Wait for completion (30s timeout)
      const waitResult = (await subagent.waitForRun({
        runId: runResult.runId,
        timeoutMs: 30_000,
      })) as { status: string; error?: string };

      if (waitResult.status !== "ok") {
        logger?.warn(
          `ClawLens: LLM eval subagent failed: ${waitResult.status} ${waitResult.error || ""}, falling through to stub`,
        );
      } else {
        // 3. Get response messages
        const messagesResult = (await subagent.getSessionMessages({
          sessionKey,
          limit: 5,
        })) as { messages: unknown[] };

        // Find the assistant's response — last message with content
        const assistantMsg = [...messagesResult.messages].reverse().find((m: unknown) => {
          const msg = m as Record<string, unknown>;
          return msg.role === "assistant" && msg.content;
        }) as Record<string, unknown> | undefined;

        if (assistantMsg?.content) {
          let raw: string;
          if (typeof assistantMsg.content === "string") {
            raw = assistantMsg.content;
          } else if (Array.isArray(assistantMsg.content)) {
            // Anthropic content block format: [{type: "text", text: "..."}]
            raw = (assistantMsg.content as Array<Record<string, unknown>>)
              .filter(
                (b: Record<string, unknown>) => b.type === "text" && typeof b.text === "string",
              )
              .map((b: Record<string, unknown>) => b.text as string)
              .join("\n");
          } else {
            raw = JSON.stringify(assistantMsg.content);
          }
          const parsed = parseEvalResponse(raw);
          if (parsed) {
            // 4. Cleanup session
            subagent.deleteSession?.({ sessionKey }).catch(() => {});
            return parsed;
          }
        }

        logger?.warn(
          "ClawLens: LLM eval returned unparseable response via subagent, falling through to stub",
        );
        subagent.deleteSession?.({ sessionKey }).catch(() => {});
      }
    }
  } catch (err) {
    logger?.warn(
      `ClawLens: LLM eval via subagent failed: ${err instanceof Error ? err.message : String(err)}, falling through to stub`,
    );
  }

  // Path 4: Stub fallback — returns tier-1 score unchanged
  logger?.warn("ClawLens: All eval paths exhausted, returning stub");
  return fallbackStub(tier1Score);
}

function fallbackStub(tier1Score: RiskScore): LlmRiskEvaluation {
  return {
    adjustedScore: tier1Score.score,
    reasoning: "Stub evaluation — LLM evaluation unavailable",
    tags: [...tier1Score.tags],
    confidence: "low",
    patterns: [],
  };
}
