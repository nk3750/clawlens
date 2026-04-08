export interface CachedEvaluation {
    adjustedScore: number;
    tier: string;
    tags: string[];
    reasoning: string;
    cachedAt: number;
    hitCount: number;
}
/**
 * Caches LLM risk evaluations by action pattern.
 *
 * Pattern key = hash of (toolName + normalized params). When the LLM returns
 * a high-confidence evaluation with an adjusted score below the LLM threshold,
 * the result is cached. Future identical actions use the cached score and skip
 * the LLM call entirely.
 */
export declare class EvalCache {
    private cache;
    private ttlMs;
    constructor(ttlMs?: number);
    /**
     * Build a cache key from tool name and params.
     * Normalizes params by sorting keys and stripping volatile values
     * (timestamps, random IDs) to increase cache hit rate.
     */
    static buildKey(toolName: string, params: Record<string, unknown>): string;
    /** Look up a cached evaluation. Returns undefined on miss or expiry. */
    get(toolName: string, params: Record<string, unknown>): CachedEvaluation | undefined;
    /**
     * Cache an LLM evaluation result if it qualifies:
     * - confidence must be "high"
     * - adjusted score must be below the LLM eval threshold
     */
    maybeCache(toolName: string, params: Record<string, unknown>, evaluation: {
        adjustedScore: number;
        confidence: string;
        tags: string[];
        reasoning: string;
    }, llmEvalThreshold: number): boolean;
    /** Number of cached patterns. */
    get size(): number;
    /** Clear all cached evaluations. */
    clear(): void;
    /**
     * Pre-warm the cache from audit log entries that have real LLM evaluations.
     * Only caches entries with high-confidence evaluations.
     * Limit to last 200 qualifying entries.
     * Returns the number of entries warmed.
     */
    warmFromAuditLog(entries: Array<{
        toolName: string;
        params: Record<string, unknown>;
        llmEvaluation?: {
            adjustedScore: number;
            confidence: string;
            tags: string[];
            reasoning: string;
        };
    }>): number;
}
