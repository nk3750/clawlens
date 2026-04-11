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
      return String(params.url ?? "");
    case "web_search":
    case "search":
      return String(params.query ?? "");
    case "browser":
      return String(params.url ?? "");
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
