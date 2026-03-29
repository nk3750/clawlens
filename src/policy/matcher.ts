import { minimatch } from "minimatch";
import type { RuleMatch } from "./types";

/**
 * Match a tool name against a pattern (exact string, glob, or array of patterns).
 * Uses minimatch (safe — tool names don't contain `/`).
 */
export function matchTool(
  toolName: string,
  pattern: string | string[],
): boolean {
  if (Array.isArray(pattern)) {
    return pattern.some((p) => minimatch(toolName, p));
  }
  return minimatch(toolName, pattern);
}

/**
 * Simple glob match for arbitrary strings (not file paths).
 * `*` matches any sequence of characters (including `/`).
 * `?` matches a single character.
 */
function globMatch(str: string, pattern: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`).test(str);
}

/**
 * Match tool params against glob patterns. Every pattern key must match.
 * Uses simple glob (not minimatch) so `*` matches `/` in values like commands.
 */
export function matchParams(
  params: Record<string, unknown>,
  patterns: Record<string, string>,
): boolean {
  for (const [key, pattern] of Object.entries(patterns)) {
    const value = params[key];
    if (value === undefined || value === null) return false;
    if (!globMatch(String(value), pattern)) return false;
  }
  return true;
}

/**
 * Match a tool call against a rule's match conditions.
 * Empty match ({}) matches everything (catch-all).
 */
export function matchRule(
  toolName: string,
  params: Record<string, unknown>,
  match: RuleMatch,
): boolean {
  // Tool name match
  if (match.tool !== undefined) {
    if (!matchTool(toolName, match.tool)) return false;
  }
  // Param pattern match
  if (match.params !== undefined) {
    if (!matchParams(params, match.params)) return false;
  }
  return true;
}
