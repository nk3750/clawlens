/**
 * Shared utilities for mapping tool calls to activity categories,
 * computing breakdowns, and generating human-readable descriptions.
 *
 * Used by api.ts (agents, sessions, entries, stats) and routes.ts (SSE).
 */

import { parseExecCommand } from "../risk/exec-parser";
import { parseSessionKey } from "./channel-catalog";

// ── Activity categories ──────────────────────────────────

export type ActivityCategory = "exploring" | "changes" | "commands" | "web" | "comms" | "data";

const TOOL_TO_CATEGORY: Record<string, ActivityCategory> = {
  read: "exploring",
  search: "exploring",
  glob: "exploring",
  grep: "exploring",
  memory_search: "exploring",
  memory_get: "exploring",
  write: "changes",
  edit: "changes",
  exec: "commands",
  process: "commands",
  fetch_url: "web",
  web_fetch: "web",
  web_search: "web",
  browser: "web",
  message: "comms",
  sessions_spawn: "comms",
  cron: "data",
};

export function getCategory(toolName: string): ActivityCategory {
  return TOOL_TO_CATEGORY[toolName] ?? "commands";
}

// ── Category breakdown ───────────────────────────────────

const ALL_CATEGORIES: ActivityCategory[] = [
  "exploring",
  "changes",
  "commands",
  "web",
  "comms",
  "data",
];

/**
 * Compute percentage breakdown from a set of entries.
 * Returns percentages that sum to 100 (or all 0 if empty).
 */
export function computeBreakdown(
  entries: Array<{ toolName: string }>,
): Record<ActivityCategory, number> {
  const counts: Record<ActivityCategory, number> = {
    exploring: 0,
    changes: 0,
    commands: 0,
    web: 0,
    comms: 0,
    data: 0,
  };

  for (const e of entries) {
    counts[getCategory(e.toolName)]++;
  }

  const total = entries.length;
  if (total === 0) return counts;

  // Convert to percentages, ensuring they sum to 100
  const result: Record<ActivityCategory, number> = {
    exploring: 0,
    changes: 0,
    commands: 0,
    web: 0,
    comms: 0,
    data: 0,
  };

  let assigned = 0;
  let largestCat: ActivityCategory = "exploring";
  let largestVal = 0;

  for (const cat of ALL_CATEGORIES) {
    const pct = Math.round((counts[cat] / total) * 100);
    result[cat] = pct;
    assigned += pct;
    if (counts[cat] > largestVal) {
      largestVal = counts[cat];
      largestCat = cat;
    }
  }

  // Fix rounding to sum to exactly 100
  if (assigned !== 100 && total > 0) {
    result[largestCat] += 100 - assigned;
  }

  return result;
}

// ── Session context parsing ──────────────────────────────

/**
 * Adapter over the channel catalog. Preserves existing outputs for
 * `main` / `cron:<job>` / `telegram` and extends to the rest of the
 * OpenClaw channel space (messaging, subagent, heartbeat, hook, unknown).
 */
export function parseSessionContext(sessionKey: string): string | undefined {
  const parsed = parseSessionKey(sessionKey);
  if (!parsed) return undefined;
  const { channel, subPath } = parsed;

  if (channel.id === "cron" && subPath.length > 0) {
    return `Cron: ${humanizeJobName(subPath.join(":"))}`;
  }
  if (channel.id === "main") return "Direct session";
  if (channel.id === "heartbeat") return "Heartbeat";
  if (channel.id === "subagent") return "Subagent";
  if (channel.id === "hook") {
    return subPath.length > 0 ? `Hook: ${subPath.join(":")}` : "Hook";
  }
  if (channel.kind === "messaging") {
    const sub = subPath[0];
    if (sub === "channel" || sub === "group" || sub === "room") {
      return `${channel.label} room`;
    }
    return `${channel.label} DM`;
  }
  // Synthesized unknown or any other kind — surface the catalog label.
  return channel.label;
}

/** Turn "trend-scan-tweet-006" into "Trend scan tweet" */
function humanizeJobName(raw: string): string {
  // Strip trailing numeric IDs like -006, -012
  const stripped = raw.replace(/-\d+$/, "").replace(/^[a-z0-9]+-/, (m) => m);
  // Replace hyphens with spaces and capitalize first letter
  const words = stripped.replace(/-/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// ── Action descriptions ──────────────────────────────────

/**
 * Generate a plain-language description of a tool call.
 * e.g., "Read config.yaml", "Ran npm test", "Searched for 'auth'"
 */
export function describeAction(entry: {
  toolName: string;
  params: Record<string, unknown>;
}): string {
  const { toolName, params } = entry;

  switch (toolName) {
    case "read": {
      const p = extractPath(params.path ?? params.file);
      return p ? `Read ${p}` : "Read file";
    }
    case "write": {
      const p = extractPath(params.path ?? params.file);
      return p ? `Write ${p}` : "Write file";
    }
    case "edit": {
      const p = extractPath(params.path ?? params.file);
      return p ? `Edit ${p}` : "Edit file";
    }
    case "glob": {
      const pattern = typeof params.pattern === "string" ? params.pattern : "";
      return pattern ? `Glob ${pattern}` : "File search";
    }
    case "grep": {
      const pattern = typeof params.pattern === "string" ? params.pattern : "";
      return pattern ? `Grep "${truncate(pattern, 30)}"` : "Content search";
    }
    case "search":
    case "web_search": {
      const q = typeof params.query === "string" ? params.query : "";
      return q ? `Search "${truncate(q, 40)}"` : "Web search";
    }
    case "fetch_url":
    case "web_fetch": {
      const url = typeof params.url === "string" ? params.url : "";
      if (!url) return "Web fetch";
      return `Fetch: ${extractUrlDomain(url)}`;
    }
    case "message": {
      const to = typeof params.to === "string" ? params.to : "";
      return to ? `Message ${truncate(to, 30)}` : "Send message";
    }
    case "exec": {
      const cmd = typeof params.command === "string" ? params.command : "";
      if (!cmd) return "Run command";
      return describeExecAction(cmd);
    }
    case "memory_get":
      return "Memory: retrieve";
    case "memory_search":
      return "Memory: search";
    case "sessions_spawn": {
      const name = typeof params.agent === "string" ? params.agent : "";
      return name ? `Spawn: ${name}` : "Spawn sub-agent";
    }
    case "cron": {
      const name = typeof params.name === "string" ? params.name : "";
      return name ? `Cron: ${name}` : "Schedule task";
    }
    case "process": {
      const action = typeof params.action === "string" ? params.action : "";
      return action ? `Process: ${action}` : "Process operation";
    }
    default:
      return toolName;
  }
}

function describeExecAction(cmd: string): string {
  const parsed = parseExecCommand(cmd);
  const primary = parsed.primaryCommand || cmd.split(/\s+/)[0];
  const idx = cmd.indexOf(primary);
  const rest = idx >= 0 ? cmd.slice(idx + primary.length).trim() : "";

  switch (parsed.category) {
    case "network-read":
    case "network-write": {
      if (parsed.urls.length > 0) {
        return `Network: ${primary} ${extractUrlDomain(parsed.urls[0])}`;
      }
      return `Network: ${primary}`;
    }
    case "read-only": {
      const arg = firstNonFlagArg(rest);
      const name = arg ? lastSegment(arg) : "";
      return name ? `Read: ${primary} ${name}` : `Read: ${primary}`;
    }
    case "search": {
      const arg = firstNonFlagArg(rest);
      return arg ? `Search: ${primary} ${truncate(arg, 30)}` : `Search: ${primary}`;
    }
    case "system-info":
      return rest ? `System: ${primary} ${truncate(rest, 25)}` : `System: ${primary}`;
    case "git-read":
    case "git-write":
      return `Git: ${truncate(rest || "command", 35)}`;
    case "destructive":
      return rest ? `Destructive: ${primary} ${truncate(rest, 30)}` : `Destructive: ${primary}`;
    case "scripting":
      return rest ? `Script: ${primary} ${truncate(rest, 30)}` : `Script: ${primary}`;
    case "package-mgmt": {
      const sub = rest.split(/\s+/)[0] || "";
      return sub ? `Package: ${primary} ${sub}` : `Package: ${primary}`;
    }
    default: {
      const shortRest = truncate(rest, 40);
      return shortRest ? `Ran ${primary} ${shortRest}` : `Ran ${primary}`;
    }
  }
}

function extractUrlDomain(url: string): string {
  const localMatch = url.match(/^(localhost|127\.\d+\.\d+\.\d+)(:\d+)?/);
  if (localMatch) return localMatch[0];
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return truncate(u.hostname, 45);
  } catch {
    return truncate(url, 45);
  }
}

function firstNonFlagArg(rest: string): string | undefined {
  for (const t of rest.split(/\s+/)) {
    if (t.length > 0 && !t.startsWith("-")) return t;
  }
  return undefined;
}

function lastSegment(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

function extractPath(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  // Show just the filename or last path segment
  const parts = value.split("/");
  const name = parts[parts.length - 1];
  if (parts.length <= 2) return value;
  return `.../${parts[parts.length - 2]}/${name}`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}\u2026`;
}

// ── Risk posture derivation ──────────────────────────────

export type RiskPosture = "calm" | "elevated" | "high" | "critical";

/**
 * Derive qualitative risk posture from an average risk score.
 *   0-20  → calm
 *   21-45 → elevated
 *   46-70 → high
 *   71+   → critical
 */
export function riskPosture(avgScore: number): RiskPosture {
  if (avgScore <= 20) return "calm";
  if (avgScore <= 45) return "elevated";
  if (avgScore <= 70) return "high";
  return "critical";
}
