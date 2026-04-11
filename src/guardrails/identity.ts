/**
 * Identity key extraction for guardrail matching.
 *
 * Used both when creating a guardrail (from audit entry) and when checking
 * in before_tool_call (from live tool call). Same function, same output —
 * exact match guaranteed.
 */

export function extractIdentityKey(toolName: string, params: Record<string, unknown>): string {
  switch (toolName) {
    case "exec":
    case "process":
      return normalizeCommand(String(params.command ?? ""));
    case "read":
    case "write":
    case "edit":
      return String(params.path ?? params.file_path ?? "");
    case "web_fetch":
    case "fetch_url":
      return normalizeUrl(String(params.url ?? ""));
    case "web_search":
    case "search":
      return String(params.query ?? "");
    case "browser":
      return normalizeUrl(String(params.url ?? ""));
    case "message":
      return String(params.to ?? params.recipient ?? "");
    case "sessions_spawn":
      return String(params.sessionKey ?? params.agent ?? "");
    case "cron":
      return `${params.name ?? ""}:${params.cron ?? ""}`;
    case "memory_search":
      return String(params.query ?? "");
    case "memory_get":
      return String(params.key ?? "");
    default:
      return JSON.stringify(sortKeys(params));
  }
}

export function normalizeCommand(cmd: string): string {
  return cmd.replace(/\s+/g, " ").trim();
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
export function normalizeUrl(raw: string): string {
  if (!raw) return raw;
  try {
    const u = new URL(raw);

    // Strip default ports (URL constructor may leave them explicit)
    if (
      (u.protocol === "https:" && u.port === "443") ||
      (u.protocol === "http:" && u.port === "80")
    ) {
      u.port = "";
    }

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
  } catch {
    // Not a valid URL — return as-is for passthrough
    return raw;
  }
}

/** Composite lookup key for O(1) guardrail matching. */
export function lookupKey(agentId: string, tool: string, identityKey: string): string {
  return `${agentId}:${tool}:${identityKey}`;
}

function sortKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = obj[key];
  }
  return sorted;
}
