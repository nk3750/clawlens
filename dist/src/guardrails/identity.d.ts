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
/**
 * URLs to match against url-glob targets. Inspects web-shaped tools' `url`
 * param plus URLs extracted from exec commands (closes Gap 1: a guardrail
 * on `https://apnews.com/**` catches `web_fetch` AND `exec curl https://…`).
 */
export declare function extractUrlsForGuardrail(toolName: string, params: Record<string, unknown>): string[];
/**
 * File paths to match against path-glob targets. For apply_patch, returns
 * every path the patch references (closes Gap 3 across write/edit AND
 * apply_patch). For find/grep/ls, returns the search directory — operators
 * who want to match against the pattern itself use identity-glob, since
 * extractIdentityKey for find/grep returns `params.pattern`.
 */
export declare function extractPathsForGuardrail(toolName: string, params: Record<string, unknown>): string[];
/**
 * The shell command to match against command-glob targets. exec only —
 * other tools have no shell-string surface.
 */
export declare function extractCommandForGuardrail(toolName: string, params: Record<string, unknown>): string | null;
