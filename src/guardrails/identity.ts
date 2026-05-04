/**
 * Identity key extraction for guardrail matching.
 *
 * Used both when creating a guardrail (from audit entry) and when checking
 * in before_tool_call (from live tool call). Same function, same output —
 * exact match guaranteed.
 */

import * as nodePath from "node:path";
import { extractAllPatchPaths } from "../dashboard/categories.js";
import { parseExecCommand } from "../risk/exec-parser.js";

export function extractIdentityKey(toolName: string, params: Record<string, unknown>): string {
  switch (toolName) {
    case "exec":
      return normalizeCommand(String(params.command ?? ""));
    case "process": {
      // Live params: {action, sessionId, limit, offset, timeout} — no command.
      // See issue #43.
      const action = String(params.action ?? "");
      const sessionId = String(params.sessionId ?? "");
      if (action || sessionId) return `${action}:${sessionId}`;
      break;
    }
    case "read":
    case "write":
    case "edit":
      return normalizePath(String(params.path ?? params.file_path ?? ""));
    case "ls":
      // pi-coding-agent registers `ls` with a single `path` param; treat its
      // identity the same way as read/write/edit so guardrails on a directory
      // travel across read/list calls without divergent keys. See issue #47.
      return normalizePath(String(params.path ?? ""));
    case "web_fetch":
    case "fetch_url":
      return normalizeUrl(String(params.url ?? ""));
    case "web_search":
      return String(params.query ?? "")
        .trim()
        .toLowerCase();
    case "browser": {
      // Live params: {action, target, url} — distinguish click/fill/scroll on
      // the same URL. See issue #43.
      const action = String(params.action ?? "");
      const url = String(params.url ?? "");
      if (action || url) return `${action}:${normalizeUrl(url)}`;
      break;
    }
    case "message": {
      // Live params: {action, target, channel, caption, media, message} —
      // no `to` or `recipient`. target wins over channel. See issue #43.
      const action = String(params.action ?? "");
      const target = String(params.target ?? "");
      const channel = String(params.channel ?? "");
      if (action || target || channel) return `${action}:${target || channel}`;
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
    case "find":
    case "grep":
      // pi-coding-agent's `find` tool uses the same `pattern` param key as
      // `grep` (find.js:72); ClawLens previously had a dead `glob` arm here
      // because OpenClaw never renamed the tool. See issue #47.
      return String(params.pattern ?? "");
  }
  // Fallthrough for process/browser/message when their identity-relevant keys
  // are all missing, and for any unknown tool — JSON-hash the params as a
  // stable last resort.
  return JSON.stringify(sortKeys(params));
}

const COMMAND_PREFIX_SKIP = new Set(["sudo", "env", "nohup", "nice", "time"]);

export function normalizeCommand(cmd: string): string {
  if (!cmd) return "";
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
    const base = t.includes("/") ? t.split("/").pop()! : t;
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
  tokens[i] = primary.includes("/") ? primary.split("/").pop()! : primary;

  return tokens.slice(i).join(" ");
}

/**
 * Normalize a file path for stable identity key matching.
 *
 * - Resolves //, /./, /../ segments via path.normalize
 * - Strips leading ./ (relative current-dir prefix)
 * - Strips trailing slash (unless root /)
 */
export function normalizePath(raw: string): string {
  if (!raw) return "";
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
  } catch {
    // Not a valid URL — return as-is for passthrough
    return raw;
  }
}

function sortKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = obj[key];
  }
  return sorted;
}

// ── Per-target-kind extractors ──────────────────────────────────
// One helper per glob target kind. Each returns a list ([] when nothing
// extractable) — the matcher in store.ts fires only on at-least-one-match,
// never auto-match-on-empty (spec §5.2).

/**
 * URLs to match against url-glob targets. Inspects web-shaped tools' `url`
 * param plus URLs extracted from exec commands (closes Gap 1: a guardrail
 * on `https://apnews.com/**` catches `web_fetch` AND `exec curl https://…`).
 */
export function extractUrlsForGuardrail(
  toolName: string,
  params: Record<string, unknown>,
): string[] {
  switch (toolName) {
    case "web_fetch":
    case "fetch_url":
    case "browser": {
      const raw = typeof params.url === "string" ? params.url : "";
      return raw ? [normalizeUrl(raw)] : [];
    }
    case "exec": {
      const cmd = typeof params.command === "string" ? params.command : "";
      if (!cmd) return [];
      return parseExecCommand(cmd).urls.map((u) => normalizeUrl(u));
    }
    default:
      return [];
  }
}

/**
 * File paths to match against path-glob targets. For apply_patch, returns
 * every path the patch references (closes Gap 3 across write/edit AND
 * apply_patch). For find/grep/ls, returns the search directory — operators
 * who want to match against the pattern itself use identity-glob, since
 * extractIdentityKey for find/grep returns `params.pattern`.
 */
export function extractPathsForGuardrail(
  toolName: string,
  params: Record<string, unknown>,
): string[] {
  switch (toolName) {
    case "read":
    case "write":
    case "edit": {
      const raw = String(params.path ?? params.file_path ?? params.file ?? "");
      return raw ? [normalizePath(raw)] : [];
    }
    case "find":
    case "grep":
    case "ls": {
      const raw = typeof params.path === "string" ? params.path : "";
      return raw ? [normalizePath(raw)] : [];
    }
    case "apply_patch": {
      const patch = typeof params.patch === "string" ? params.patch : "";
      return extractAllPatchPaths(patch);
    }
    default:
      return [];
  }
}

/**
 * The shell command to match against command-glob targets. exec only —
 * other tools have no shell-string surface.
 */
export function extractCommandForGuardrail(
  toolName: string,
  params: Record<string, unknown>,
): string | null {
  if (toolName !== "exec") return null;
  return normalizeCommand(typeof params.command === "string" ? params.command : "");
}
