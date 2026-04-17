/**
 * Shared utilities for mapping tool calls to activity categories,
 * computing breakdowns, and generating human-readable descriptions.
 *
 * Used by api.ts (agents, sessions, entries, stats) and routes.ts (SSE).
 */
export type ActivityCategory = "exploring" | "changes" | "commands" | "web" | "comms" | "data";
export declare function getCategory(toolName: string): ActivityCategory;
/**
 * Compute percentage breakdown from a set of entries.
 * Returns percentages that sum to 100 (or all 0 if empty).
 */
export declare function computeBreakdown(entries: Array<{
    toolName: string;
}>): Record<ActivityCategory, number>;
/**
 * Adapter over the channel catalog. Preserves existing outputs for
 * `main` / `cron:<job>` / `telegram` and extends to the rest of the
 * OpenClaw channel space (messaging, subagent, heartbeat, hook, unknown).
 */
export declare function parseSessionContext(sessionKey: string): string | undefined;
/**
 * Generate a plain-language description of a tool call.
 * e.g., "Read config.yaml", "Ran npm test", "Searched for 'auth'"
 */
export declare function describeAction(entry: {
    toolName: string;
    params: Record<string, unknown>;
}): string;
export type RiskPosture = "calm" | "elevated" | "high" | "critical";
/**
 * Derive qualitative risk posture from an average risk score.
 *   0-20  → calm
 *   21-45 → elevated
 *   46-70 → high
 *   71+   → critical
 */
export declare function riskPosture(avgScore: number): RiskPosture;
