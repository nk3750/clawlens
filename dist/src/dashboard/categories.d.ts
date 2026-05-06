/**
 * Shared utilities for mapping tool calls to activity categories,
 * computing breakdowns, and generating human-readable descriptions.
 *
 * Used by api.ts (agents, sessions, entries, stats) and routes.ts (SSE).
 */
import type { Action, Selector, Target } from "../guardrails/types.js";
/**
 * Pure "domain of work" buckets. Risk severity lives on a separate axis
 * (see RiskMixMicrobar on the agent card) — nothing here encodes risk.
 *
 * - `scripts` is the fallback for unknown tool names and unknown exec
 *   sub-categories. It replaces the retired `commands` catch-all.
 * - Every tool name and every ExecCategory routes into exactly one bucket.
 */
export type ActivityCategory = "exploring" | "changes" | "git" | "scripts" | "web" | "comms" | "orchestration" | "media";
export declare function getCategory(toolName: string, execCategory?: string): ActivityCategory;
/**
 * Route a full AuditEntry-shaped record to its activity bucket, deriving the
 * exec sub-category from `params.command` for exec calls. Call sites that
 * carry the full entry should prefer this over `getCategory(toolName)` so
 * exec calls are bucketed by domain (git / changes / web / exploring) rather
 * than always falling into the scripts fallback.
 */
export declare function getCategoryFromEntry(entry: {
    toolName: string;
    params?: Record<string, unknown>;
    execCategory?: string;
}): ActivityCategory;
/**
 * Set of tool names ClawLens recognizes — TOOL_TO_CATEGORY keys plus the
 * implicit "exec" tool (routed via execCategory rather than the table).
 * Used by the POST /api/guardrails validator to surface warnings for
 * unknown names without rejecting them — operators may legitimately want
 * to pre-create rules for tools ClawLens hasn't audited yet.
 */
export declare const KNOWN_TOOL_NAMES: ReadonlySet<string>;
export declare const ALL_CATEGORIES: ActivityCategory[];
/**
 * Compute percentage breakdown from a set of entries.
 * Returns percentages that sum to 100 (or all 0 if empty).
 *
 * `exec` entries route by `execCategory` when supplied. If only `params`
 * is provided (AuditEntry shape) we derive the sub-category from
 * `params.command`, so call sites can pass raw AuditEntry arrays without
 * pre-parsing.
 */
export declare function computeBreakdown(entries: Array<{
    toolName: string;
    execCategory?: string;
    params?: Record<string, unknown>;
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
/**
 * Extract every path a unified-diff or Codex-style patch references. Used
 * by guardrail path-glob matching (src/guardrails/identity.ts) and by
 * extractFirstPatchPath above. Each path is normalized via nodePath.normalize
 * (collapses //, ./, ../) and trailing slash, then deduped.
 *
 * Path normalization is inlined here rather than imported from
 * src/guardrails/identity.ts to avoid a cycle: types.ts → categories.ts is
 * already established, and identity.ts pulls extractAllPatchPaths from us.
 */
export declare function extractAllPatchPaths(patch: string): string[];
export declare function formatTargetSummary(target: Target): string;
export declare function describeRule(input: {
    selector: Selector;
    target: Target;
    action: Action;
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
