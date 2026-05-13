/**
 * LLM health tracker — rolling record of Claude/OpenAI/etc. call outcomes
 * so the dashboard can flag when eval or summary calls are degraded.
 *
 * Instances: a singleton `llmHealthTracker` is exported and wired at every
 * LLM call site in ClawLens (risk evaluator + session summarizer).
 * The class itself is exported for tests and future scoped usage.
 */
export type LlmFailureReason = "no_key" | "billing" | "rate_limit" | "provider" | "other";
export type LlmHealthStatus = "ok" | "degraded" | "down";
export interface LlmHealthAttempt {
    timestamp: number;
    ok: boolean;
    reason?: LlmFailureReason;
}
export interface LlmHealthSnapshot {
    /** Attempts that landed inside the 15-minute rolling window. */
    recentAttempts: number;
    /** Failures within the same window. */
    recentFailures: number;
    lastFailureIso?: string;
    lastFailureReason?: LlmFailureReason;
    status: LlmHealthStatus;
}
/**
 * Classify a raw error message into a structured reason. Pattern list matches
 * the spec — callers pass `err.message` or equivalent. Never-seen messages
 * fall through to "other" so the tracker still records them.
 */
export declare function classifyError(errMsg?: string): LlmFailureReason;
export declare class LlmHealthTracker {
    private attempts;
    /**
     * Record a single LLM call. `ok: true` → success. `ok: false` with the raw
     * error message lets us classify billing/rate_limit/provider failures.
     */
    recordAttempt(ok: boolean, reason?: string): void;
    snapshot(now?: Date): LlmHealthSnapshot;
    /**
     * Rule set (from spec):
     *   - last 3 attempts all failed → down
     *   - 3+ failures AND >50% of recent failed → degraded
     *   - otherwise → ok
     */
    private computeStatus;
    /** Test hook — wipe state. Not for production use. */
    reset(): void;
}
/** Process-wide singleton used by evaluator + session summarizer. */
export declare const llmHealthTracker: LlmHealthTracker;
