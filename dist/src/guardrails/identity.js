/**
 * Identity key extraction for guardrail matching.
 *
 * Used both when creating a guardrail (from audit entry) and when checking
 * in before_tool_call (from live tool call). Same function, same output —
 * exact match guaranteed.
 */
import * as nodePath from "node:path";
export function extractIdentityKey(toolName, params) {
    switch (toolName) {
        case "exec":
            return normalizeCommand(String(params.command ?? ""));
        case "process": {
            // Live params: {action, sessionId, limit, offset, timeout} — no command.
            // See issue #43.
            const action = String(params.action ?? "");
            const sessionId = String(params.sessionId ?? "");
            if (action || sessionId)
                return `${action}:${sessionId}`;
            break;
        }
        case "read":
        case "write":
        case "edit":
            return normalizePath(String(params.path ?? params.file_path ?? ""));
        case "web_fetch":
        case "fetch_url":
            return normalizeUrl(String(params.url ?? ""));
        case "web_search":
        case "search":
            return String(params.query ?? "")
                .trim()
                .toLowerCase();
        case "browser": {
            // Live params: {action, target, url} — distinguish click/fill/scroll on
            // the same URL. See issue #43.
            const action = String(params.action ?? "");
            const url = String(params.url ?? "");
            if (action || url)
                return `${action}:${normalizeUrl(url)}`;
            break;
        }
        case "message": {
            // Live params: {action, target, channel, caption, media, message} —
            // no `to` or `recipient`. target wins over channel. See issue #43.
            const action = String(params.action ?? "");
            const target = String(params.target ?? "");
            const channel = String(params.channel ?? "");
            if (action || target || channel)
                return `${action}:${target || channel}`;
            break;
        }
        case "sessions_spawn":
            return String(params.sessionKey ?? params.agent ?? "").trim();
        case "cron": {
            const name = String(params.name ?? "").trim();
            const expr = String(params.cron ?? "")
                .replace(/\s+/g, " ")
                .trim();
            return `${name}:${expr}`;
        }
        case "memory_search":
            return String(params.query ?? "")
                .trim()
                .toLowerCase();
        case "memory_get":
            return String(params.key ?? "")
                .trim()
                .toLowerCase();
        case "glob":
        case "grep":
            return String(params.pattern ?? "");
    }
    // Fallthrough for process/browser/message when their identity-relevant keys
    // are all missing, and for any unknown tool — JSON-hash the params as a
    // stable last resort.
    return JSON.stringify(sortKeys(params));
}
const COMMAND_PREFIX_SKIP = new Set(["sudo", "env", "nohup", "nice", "time"]);
export function normalizeCommand(cmd) {
    if (!cmd)
        return "";
    // Collapse whitespace first
    const tokens = cmd.replace(/\s+/g, " ").trim().split(" ");
    let i = 0;
    // Skip env var assignments (FOO=bar) and prefix commands (sudo, env, etc.)
    while (i < tokens.length) {
        const t = tokens[i];
        // Skip env var assignments like FOO=bar
        if (/^[A-Za-z_]\w*=/.test(t)) {
            i++;
            continue;
        }
        // Skip known prefix commands
        const base = t.includes("/") ? t.split("/").pop() : t;
        if (COMMAND_PREFIX_SKIP.has(base)) {
            i++;
            continue;
        }
        break;
    }
    if (i >= tokens.length) {
        // Entire command was prefixes — return as whitespace-collapsed string
        return tokens.join(" ");
    }
    // Strip absolute path from the primary command
    const primary = tokens[i];
    tokens[i] = primary.includes("/") ? primary.split("/").pop() : primary;
    return tokens.slice(i).join(" ");
}
/**
 * Normalize a file path for stable identity key matching.
 *
 * - Resolves //, /./, /../ segments via path.normalize
 * - Strips leading ./ (relative current-dir prefix)
 * - Strips trailing slash (unless root /)
 */
export function normalizePath(raw) {
    if (!raw)
        return "";
    // path.normalize handles //, /./, /../
    let result = nodePath.normalize(raw);
    // Strip trailing slash (unless root /)
    if (result.length > 1 && result.endsWith("/")) {
        result = result.slice(0, -1);
    }
    return result;
}
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
export function normalizeUrl(raw) {
    if (!raw)
        return raw;
    try {
        const u = new URL(raw);
        // Strip default ports (URL constructor may leave them explicit)
        if ((u.protocol === "https:" && u.port === "443") ||
            (u.protocol === "http:" && u.port === "80")) {
            u.port = "";
        }
        // Strip credentials — user:pass@ is not part of resource identity
        u.username = "";
        u.password = "";
        // Strip fragment
        u.hash = "";
        // Sort query parameters
        const sorted = new URLSearchParams([...u.searchParams.entries()].sort());
        u.search = sorted.size > 0 ? `?${sorted.toString()}` : "";
        // Build result, stripping trailing slash when path is just "/"
        let result = u.toString();
        if (u.pathname === "/" && !u.search) {
            result = result.replace(/\/$/, "");
        }
        return result;
    }
    catch {
        // Not a valid URL — return as-is for passthrough
        return raw;
    }
}
/** Composite lookup key for O(1) guardrail matching. */
export function lookupKey(agentId, tool, identityKey) {
    return `${agentId}:${tool}:${identityKey}`;
}
function sortKeys(obj) {
    const sorted = {};
    for (const key of Object.keys(obj).sort()) {
        sorted[key] = obj[key];
    }
    return sorted;
}
//# sourceMappingURL=identity.js.map