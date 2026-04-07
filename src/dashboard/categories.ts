/**
 * Shared utilities for mapping tool calls to activity categories,
 * computing breakdowns, and generating human-readable descriptions.
 *
 * Used by api.ts (agents, sessions, entries, stats) and routes.ts (SSE).
 */

import { parseExecCommand } from "../risk/exec-parser";

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
 * Parse a sessionKey into a human-readable context string.
 *
 * Known formats from production:
 *   agent:{id}:cron:{job-name}           → "Cron: {humanized job name}"
 *   agent:{id}:telegram:direct:{userId}  → "Telegram DM"
 *   agent:{id}:main                      → "Direct session"
 */
export function parseSessionContext(sessionKey: string): string | undefined {
  if (!sessionKey) return undefined;

  const parts = sessionKey.split(":");

  // agent:{id}:{channel}:...
  if (parts.length < 3) return undefined;

  const channel = parts[2];

  if (channel === "cron" && parts.length >= 4) {
    // agent:social-manager:cron:trend-scan-tweet-006
    const jobName = parts.slice(3).join(":");
    return `Cron: ${humanizeJobName(jobName)}`;
  }

  if (channel === "telegram") {
    return "Telegram DM";
  }

  if (channel === "main") {
    return "Direct session";
  }

  return undefined;
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
      return url ? `Fetch ${truncate(url, 50)}` : "Web fetch";
    }
    case "message": {
      const to = typeof params.to === "string" ? params.to : "";
      return to ? `Message ${truncate(to, 30)}` : "Send message";
    }
    case "exec": {
      const cmd = typeof params.command === "string" ? params.command : "";
      if (!cmd) return "Run command";
      const parsed = parseExecCommand(cmd);
      const primary = parsed.primaryCommand || cmd.split(/\s+/)[0];
      // Build a short description from the primary command + first meaningful arg
      const rest = cmd.slice(cmd.indexOf(primary) + primary.length).trim();
      const shortRest = truncate(rest, 40);
      return shortRest ? `Ran ${primary} ${shortRest}` : `Ran ${primary}`;
    }
    case "sessions_spawn": {
      const name = typeof params.agent === "string" ? params.agent : "";
      return name ? `Spawn agent ${name}` : "Spawn sub-agent";
    }
    case "cron": {
      const name = typeof params.name === "string" ? params.name : "";
      return name ? `Cron: ${name}` : "Schedule task";
    }
    case "process": {
      const action = typeof params.action === "string" ? params.action : "";
      return action ? `Process ${action}` : "Process operation";
    }
    default:
      return toolName;
  }
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
