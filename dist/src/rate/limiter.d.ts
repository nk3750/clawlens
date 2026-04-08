export declare class RateLimiter {
    private counters;
    private statePath;
    private restored;
    constructor(statePath: string);
    /** Restore rate limit state from disk (idempotent). */
    restore(): void;
    /** Persist rate limit state to disk. */
    persist(): void;
    /** Record a tool call for rate limiting. */
    record(toolName: string, ruleName?: string): void;
    /** Get the count of actions within a sliding window. */
    getCount(toolName: string, ruleName: string, windowSec: number): number;
    /** Remove expired entries older than 24 hours. */
    cleanup(): void;
}
