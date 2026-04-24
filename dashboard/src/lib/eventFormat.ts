// Headline + target primitives used by LiveFeed (two-line format) and the
// legacy describeEntry adapter in groupEntries.ts.
//
// Spec: docs/product/homepage-bottom-row-spec.md §1-§3
//
// Exhaustive: every toolName in categories.ts, every ExecCategory in
// src/risk/exec-parser.ts, every decision override.

import { parseExecCommand } from "../../../src/risk/exec-parser";
import type { EntryResponse } from "./types";

// ─────────────────────────────────────────────────────────────
// Tool-namespace map (spec §1)
// ─────────────────────────────────────────────────────────────

const TOOL_NAMESPACE: Record<string, string> = {
  read: "fs.read",
  write: "fs.write",
  edit: "fs.edit",
  glob: "fs.glob",
  grep: "fs.grep",
  search: "web.search",
  web_search: "web.search",
  web_fetch: "net.fetch",
  fetch_url: "net.fetch",
  browser: "net.browser",
  memory_get: "memory.get",
  memory_search: "memory.search",
  message: "comm.send",
  sessions_spawn: "agent.spawn",
  cron: "schedule.install",
};

export function toolNamespace(entry: EntryResponse): string {
  if (entry.toolName === "exec") {
    const cmd = typeof entry.params.command === "string" ? entry.params.command : "";
    if (!cmd) return "shell.exec";
    const parsed = parseExecCommand(cmd);
    return parsed.primaryCommand ? `shell.${parsed.primaryCommand}` : "shell.exec";
  }
  if (entry.toolName === "process") {
    const action = typeof entry.params.action === "string" ? entry.params.action : "";
    return action ? `process.${action}` : "process.op";
  }
  return TOOL_NAMESPACE[entry.toolName] ?? entry.toolName;
}

// ─────────────────────────────────────────────────────────────
// Verb map (spec §2)
// ─────────────────────────────────────────────────────────────

const TOOL_VERB: Record<string, string> = {
  read: "read",
  write: "wrote",
  edit: "edited",
  glob: "scanned",
  grep: "searched",
  search: "searched",
  web_search: "searched",
  web_fetch: "fetched",
  fetch_url: "fetched",
  browser: "opened",
  memory_get: "recalled",
  memory_search: "searched",
  message: "sent",
  sessions_spawn: "spawned",
  cron: "scheduled",
};

/** All 15 ExecCategory values from src/risk/exec-parser.ts:9-24. */
const EXEC_VERB: Record<string, string> = {
  "read-only": "ran",
  search: "searched",
  "system-info": "queried",
  echo: "printed",
  "git-read": "queried",
  "git-write": "committed",
  "network-read": "fetched",
  "network-write": "posted",
  scripting: "ran",
  "package-mgmt": "installed",
  destructive: "ran",
  permissions: "changed",
  persistence: "installed",
  remote: "connected",
  "unknown-exec": "ran",
};

export function verbFor(entry: EntryResponse): string {
  const dec = entry.effectiveDecision;
  // Block/timeout: the action was attempted but did NOT execute. "Proposed"
  // conveys intent without outcome. Pending keeps the base verb (awaiting,
  // not denied).
  if (dec === "block" || dec === "timeout") return "proposed";

  if (entry.toolName === "exec") {
    const ec = entry.execCategory ?? "unknown-exec";
    return EXEC_VERB[ec] ?? EXEC_VERB["unknown-exec"];
  }
  if (entry.toolName === "process") {
    const a =
      typeof entry.params.action === "string" ? entry.params.action.toLowerCase() : "";
    return a || "operated";
  }
  return TOOL_VERB[entry.toolName] ?? entry.toolName;
}

// ─────────────────────────────────────────────────────────────
// Target-line formatter (spec §3)
// ─────────────────────────────────────────────────────────────

export function formatEventTarget(entry: EntryResponse): string {
  const p = entry.params;
  const str = (v: unknown) => (typeof v === "string" ? v : "");

  switch (entry.toolName) {
    case "read":
    case "write":
    case "edit":
      return str(p.path) || str(p.file_path);
    case "glob":
    case "grep": {
      const pat = str(p.pattern);
      return pat ? `"${pat}"` : "";
    }
    case "search":
    case "web_search":
    case "memory_search": {
      const q = str(p.query);
      return q ? `"${q}"` : "";
    }
    case "web_fetch":
    case "fetch_url":
    case "browser":
      return str(p.url);
    case "memory_get":
      return str(p.key) || "(all memories)";
    case "message": {
      const to = str(p.to);
      const subj = str(p.subject);
      if (to && subj) return `${to}: "${subj}"`;
      if (to) return to;
      return subj ? `"${subj}"` : "";
    }
    case "sessions_spawn":
      return str(p.agent);
    case "cron":
      return str(p.name) || "(unnamed)";
    case "process":
      return str(p.target);
    case "exec":
      return str(p.command);
    default:
      return "";
  }
}
