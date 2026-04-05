import type { RiskScore, RiskTier } from "./types";

// Base risk scores by tool type
const BASE_SCORES: Record<string, number> = {
  read: 5,
  glob: 5,
  grep: 5,
  memory_search: 5,
  memory_get: 5,
  web_search: 10,
  write: 40,
  edit: 40,
  web_fetch: 45,
  browser: 45,
  message: 50,
  process: 60,
  exec: 70,
  sessions_spawn: 75,
  cron: 80,
};

const DEFAULT_BASE = 30; // Unknown tools get a moderate score

interface Modifier {
  match: (toolName: string, params: Record<string, unknown>) => boolean;
  delta: number;
  reason: string;
  tag: string;
}

function paramContains(
  params: Record<string, unknown>,
  key: string,
  ...needles: string[]
): boolean {
  const val = params[key];
  if (typeof val !== "string") return false;
  const lower = val.toLowerCase();
  return needles.some((n) => lower.includes(n));
}

function pathMatches(
  params: Record<string, unknown>,
  ...patterns: string[]
): boolean {
  const p =
    typeof params.path === "string"
      ? params.path
      : typeof params.file_path === "string"
        ? params.file_path
        : "";
  if (!p) return false;
  return patterns.some((pat) => p.includes(pat));
}

const MODIFIERS: Modifier[] = [
  // exec command modifiers
  {
    match: (t, p) => t === "exec" && paramContains(p, "command", "rm", "delete"),
    delta: 15,
    reason: 'exec command contains "rm" or "delete"',
    tag: "destructive",
  },
  {
    match: (t, p) => t === "exec" && paramContains(p, "command", "push", "deploy"),
    delta: 10,
    reason: 'exec command contains "push" or "deploy"',
    tag: "deployment",
  },
  {
    match: (t, p) => t === "exec" && paramContains(p, "command", "merge"),
    delta: 10,
    reason: 'exec command contains "merge"',
    tag: "git-merge",
  },
  {
    match: (t, p) => t === "exec" && paramContains(p, "command", "--force", "-f"),
    delta: 15,
    reason: 'exec command contains "--force" or "-f"',
    tag: "force-flag",
  },
  {
    match: (t, p) => t === "exec" && paramContains(p, "command", "curl", "wget"),
    delta: 10,
    reason: 'exec command contains "curl" or "wget"',
    tag: "network",
  },
  {
    match: (t, p) => t === "exec" && paramContains(p, "command", "ssh", "scp"),
    delta: 10,
    reason: 'exec command contains "ssh" or "scp"',
    tag: "remote-access",
  },
  {
    match: (t, p) =>
      t === "exec" && paramContains(p, "command", "crontab", "launchd"),
    delta: 15,
    reason: 'exec command contains "crontab" or "launchd"',
    tag: "persistence",
  },
  {
    match: (t, p) => t === "exec" && paramContains(p, "command", "chmod", "chown"),
    delta: 10,
    reason: 'exec command contains "chmod" or "chown"',
    tag: "permissions",
  },
  {
    match: (t, p) =>
      t === "exec" && paramContains(p, "command", "pip install", "npm install"),
    delta: 5,
    reason: 'exec command contains "pip install" or "npm install"',
    tag: "package-install",
  },

  // web_fetch external URL
  {
    match: (t, p) => {
      if (t !== "web_fetch") return false;
      const url = typeof p.url === "string" ? p.url : "";
      if (!url) return false;
      // Check if URL is NOT localhost/127.*
      return !(/localhost|127\.\d+\.\d+\.\d+/i.test(url));
    },
    delta: 10,
    reason: "web_fetch URL is external (not localhost/127)",
    tag: "external-network",
  },

  // write/edit path modifiers
  {
    match: (t, p) =>
      (t === "write" || t === "edit") && pathMatches(p, ".env"),
    delta: 20,
    reason: "write/edit path matches .env",
    tag: "credential-access",
  },
  {
    match: (t, p) =>
      (t === "write" || t === "edit") && pathMatches(p, ".ssh"),
    delta: 20,
    reason: "write/edit path matches .ssh",
    tag: "credential-access",
  },
  {
    match: (t, p) =>
      (t === "write" || t === "edit") && pathMatches(p, "/etc/", "/usr/"),
    delta: 25,
    reason: "write/edit path matches /etc/ or /usr/",
    tag: "system-file",
  },
  {
    match: (t, p) =>
      (t === "write" || t === "edit") && pathMatches(p, ".git/"),
    delta: 15,
    reason: "write/edit path matches .git/",
    tag: "git-internal",
  },

  // message modifier
  {
    match: (t) => t === "message",
    delta: 5,
    reason: "message tool",
    tag: "communication",
  },

  // process modifiers
  {
    match: (t, p) => {
      if (t !== "process") return false;
      const action = typeof p.action === "string" ? p.action : "";
      return action === "start" || action === "spawn";
    },
    delta: 10,
    reason: 'process action is "start" or "spawn"',
    tag: "process-spawn",
  },
  {
    match: (t, p) => {
      if (t !== "process") return false;
      const action = typeof p.action === "string" ? p.action : "";
      return action === "poll" || action === "status";
    },
    delta: -55,
    reason: 'process action is "poll" or "status"',
    tag: "process-internal",
  },
];

function getTier(score: number): RiskTier {
  if (score >= 80) return "critical";
  if (score >= 60) return "high";
  if (score >= 30) return "medium";
  return "low";
}

export function computeRiskScore(
  toolName: string,
  params: Record<string, unknown>,
  llmEvalThreshold: number = 75,
): RiskScore {
  const base = BASE_SCORES[toolName] ?? DEFAULT_BASE;
  const modifiers: Array<{ reason: string; delta: number }> = [];
  const tags: string[] = [];

  let score = base;

  for (const mod of MODIFIERS) {
    if (mod.match(toolName, params)) {
      modifiers.push({ reason: mod.reason, delta: mod.delta });
      tags.push(mod.tag);
      score += mod.delta;
    }
  }

  // Floor at 5 for process poll/status, 0 for everything else
  const floor = tags.includes("process-internal") ? 5 : 0;
  score = Math.max(floor, Math.min(100, score));

  return {
    score,
    tier: getTier(score),
    tags,
    breakdown: { base, modifiers },
    needsLlmEval: score >= llmEvalThreshold,
  };
}
