import type { RuleMatch } from "./types";
/**
 * Match a tool name against a pattern (exact string, glob, or array of patterns).
 * Uses minimatch (safe — tool names don't contain `/`).
 */
export declare function matchTool(toolName: string, pattern: string | string[]): boolean;
/**
 * Match tool params against glob patterns. Every pattern key must match.
 * Uses simple glob (not minimatch) so `*` matches `/` in values like commands.
 */
export declare function matchParams(params: Record<string, unknown>, patterns: Record<string, string>): boolean;
/**
 * Match a tool call against a rule's match conditions.
 * Empty match ({}) matches everything (catch-all).
 */
export declare function matchRule(toolName: string, params: Record<string, unknown>, match: RuleMatch): boolean;
