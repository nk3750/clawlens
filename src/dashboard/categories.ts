import { parseExecCommand } from "../risk/exec-parser";

export type ActivityCategory =
  | "exploring"
  | "changes"
  | "commands"
  | "web"
  | "comms"
  | "data";

const TOOL_TO_CATEGORY: Record<string, ActivityCategory> = {
  read: "exploring",
  search: "exploring",
  glob: "exploring",
  grep: "exploring",
  write: "changes",
  edit: "changes",
  exec: "commands",
  fetch_url: "web",
  message: "comms",
};

export function getCategory(toolName: string): ActivityCategory {
  return TOOL_TO_CATEGORY[toolName] ?? "commands";
}

const ALL_CATEGORIES: ActivityCategory[] = [
  "exploring",
  "changes",
  "commands",
  "web",
  "comms",
  "data",
];

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

  const total = entries.length || 1;
  const result: Record<ActivityCategory, number> = {
    exploring: 0,
    changes: 0,
    commands: 0,
    web: 0,
    comms: 0,
    data: 0,
  };

  let assigned = 0;
  const sorted = ALL_CATEGORIES
    .map((cat) => ({ cat, pct: Math.round((counts[cat] / total) * 100) }))
    .sort((a, b) => b.pct - a.pct);

  for (let i = 0; i < sorted.length; i++) {
    if (i === sorted.length - 1) {
      // Last category gets the remainder to ensure sum = 100
      result[sorted[i].cat] = Math.max(0, 100 - assigned);
    } else {
      result[sorted[i].cat] = sorted[i].pct;
      assigned += sorted[i].pct;
    }
  }

  return result;
}

export function parseSessionContext(
  sessionKey: string,
): string | undefined {
  if (!sessionKey) return undefined;
  const parts = sessionKey.split(":");
  // Format: agent:<agentId>:<channel>:<trigger>:<...>
  if (parts.length < 3) return undefined;

  const channel = parts[2];
  const trigger = parts.slice(3).join(":");

  if (channel === "cron") return trigger || "Scheduled task";
  if (channel === "telegram") return "via Telegram";
  if (channel === "web") return "via Web";
  if (channel === "api") return "via API";
  if (channel && trigger) return `${channel}: ${trigger}`;
  if (channel) return `via ${channel}`;
  return undefined;
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + "\u2026" : str;
}

export function describeAction(entry: {
  toolName: string;
  params: Record<string, unknown>;
}): string {
  const { toolName, params } = entry;
  switch (toolName) {
    case "read":
      return params.path ? `Read ${truncate(String(params.path), 40)}` : "Read file";
    case "write":
      return params.path
        ? `Write to ${truncate(String(params.path), 40)}`
        : "Write file";
    case "edit":
      return params.path
        ? `Edit ${truncate(String(params.path), 40)}`
        : "Edit file";
    case "exec": {
      if (!params.command) return "Execute command";
      const parsed = parseExecCommand(String(params.command));
      return `Run \`${truncate(parsed.primaryCommand + (parsed.flags.length ? " " + parsed.flags[0] : ""), 35)}\``;
    }
    case "message":
      if (params.to && params.subject)
        return `Email "${truncate(String(params.subject), 25)}" to ${params.to}`;
      if (params.to) return `Message to ${params.to}`;
      return "Send message";
    case "search":
      return params.query
        ? `Search "${truncate(String(params.query), 30)}"`
        : "Search";
    case "glob":
      return params.pattern
        ? `Glob ${truncate(String(params.pattern), 35)}`
        : "Glob search";
    case "grep":
      return params.pattern
        ? `Grep "${truncate(String(params.pattern), 30)}"`
        : "Grep search";
    case "fetch_url":
      return params.url
        ? `Fetch ${truncate(String(params.url), 40)}`
        : "Fetch URL";
    default:
      return toolName;
  }
}

export function riskPosture(
  avgScore: number,
): "calm" | "elevated" | "high" | "critical" {
  if (avgScore >= 71) return "critical";
  if (avgScore >= 46) return "high";
  if (avgScore >= 21) return "elevated";
  return "calm";
}
