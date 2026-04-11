/**
 * Identity key extraction for guardrail matching.
 *
 * Used both when creating a guardrail (from audit entry) and when checking
 * in before_tool_call (from live tool call). Same function, same output —
 * exact match guaranteed.
 */
export declare function extractIdentityKey(toolName: string, params: Record<string, unknown>): string;
export declare function normalizeCommand(cmd: string): string;
/**
 * Normalize a file path for stable identity key matching.
 *
 * - Resolves //, /./, /../ segments via path.normalize
 * - Strips leading ./ (relative current-dir prefix)
 * - Strips trailing slash (unless root /)
 */
export declare function normalizePath(raw: string): string;
/**
 * Normalize a URL for stable identity key matching.
 *
 * - Lowercases protocol and hostname (URL constructor handles this)
 * - Strips default ports (443 for https, 80 for http)
 * - Strips fragment (#...)
 * - Sorts query parameters alphabetically
 * - Strips trailing slash when path is just "/"
 * - Falls back to raw string if URL parsing fails
 */
export declare function normalizeUrl(raw: string): string;
/** Composite lookup key for O(1) guardrail matching. */
export declare function lookupKey(agentId: string, tool: string, identityKey: string): string;
