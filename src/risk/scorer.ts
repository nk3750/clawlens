import { EXEC_BASE_SCORES, type ParsedExecCommand, parseExecCommand } from "./exec-parser.js";
import type { RiskScore, RiskTier } from "./types.js";

// Base risk scores by tool type (non-exec). Tool names mirror what
// pi-coding-agent registers — read/find/grep/ls — see issue #47. The dead
// `glob` entry was dropped because OpenClaw never renamed the tool.
const BASE_SCORES: Record<string, number> = {
  read: 5,
  find: 5,
  grep: 5,
  ls: 5,
  memory_search: 5,
  memory_get: 5,
  web_search: 10,
  write: 40,
  edit: 40,
  web_fetch: 45,
  browser: 45,
  message: 50,
  process: 60,
  // exec is handled via sub-classification — see getExecBase()
  sessions_spawn: 75,
  cron: 80,
};

const DEFAULT_BASE = 30; // Unknown tools get a moderate score

interface Modifier {
  match: (toolName: string, params: Record<string, unknown>, parsed?: ParsedExecCommand) => boolean;
  delta: number;
  reason: string;
  tag: string;
}

function pathMatches(params: Record<string, unknown>, ...patterns: string[]): boolean {
  const p =
    typeof params.path === "string"
      ? params.path
      : typeof params.file_path === "string"
        ? params.file_path
        : "";
  if (!p) return false;
  return patterns.some((pat) => p.includes(pat));
}

// ── Localhost detection for network commands ──────────────────

const LOCALHOST_PATTERNS = [
  /^localhost(:\d+)?(\/|$)/i,
  /^127\.\d+\.\d+\.\d+(:\d+)?(\/|$)/,
  /^\[?::1\]?(:\d+)?(\/|$)/,
  /^https?:\/\/localhost(:\d+)?(\/|$)/i,
  /^https?:\/\/127\.\d+\.\d+\.\d+(:\d+)?(\/|$)/,
  /^https?:\/\/\[?::1\]?(:\d+)?(\/|$)/,
];

function isLocalhostUrl(url: string): boolean {
  return LOCALHOST_PATTERNS.some((pat) => pat.test(url));
}

function allUrlsAreLocal(urls: string[]): boolean {
  if (urls.length === 0) return true; // no URLs = no external network
  return urls.every(isLocalhostUrl);
}

// ── Exec-specific modifiers (use parsed command info) ────────

const EXEC_MODIFIERS: Modifier[] = [
  // destructive: only if parsed category IS destructive OR primaryCommand is rm/kill/etc.
  // NOT from substring matching inside Python code
  {
    match: (_t, _p, parsed) => {
      if (!parsed) return false;
      return parsed.category === "destructive";
    },
    delta: 15,
    reason: "exec command is destructive (rm, kill, etc.)",
    tag: "destructive",
  },

  // force-flag: --force on any command, but short -f only on commands where it means "force"
  // (not test/[/tar/tail/awk/ssh/grep where -f means something else)
  {
    match: (_t, _p, parsed) => {
      if (!parsed) return false;
      const hasLongForce = parsed.flags.includes("--force");
      if (hasLongForce) return true;
      // Short -f only means "force" on these commands
      const FORCE_F_COMMANDS = new Set(["rm", "cp", "mv", "ln", "rmdir"]);
      if (!FORCE_F_COMMANDS.has(parsed.primaryCommand)) return false;
      return parsed.flags.some((f) => {
        if (f.startsWith("--")) return false;
        const chars = f.slice(1);
        return chars.includes("f");
      });
    },
    delta: 15,
    reason: "exec command has --force or -f flag",
    tag: "force-flag",
  },

  // network: split into local vs external based on parsed URLs
  {
    match: (_t, _p, parsed) => {
      if (!parsed) return false;
      if (parsed.category !== "network-read" && parsed.category !== "network-write") return false;
      return allUrlsAreLocal(parsed.urls);
    },
    delta: 0,
    reason: "exec network command targeting localhost",
    tag: "network-local",
  },
  {
    match: (_t, _p, parsed) => {
      if (!parsed) return false;
      if (parsed.category !== "network-read" && parsed.category !== "network-write") return false;
      return !allUrlsAreLocal(parsed.urls);
    },
    delta: 10,
    reason: "exec network command targeting external URL",
    tag: "network-external",
  },

  // deployment: only for git-write commands containing push/deploy
  {
    match: (_t, _p, parsed) => {
      if (!parsed) return false;
      if (parsed.category !== "git-write") return false;
      const cmd = parsed.segments.join(" ").toLowerCase();
      return cmd.includes("push") || cmd.includes("deploy");
    },
    delta: 10,
    reason: "exec git push/deploy command",
    tag: "deployment",
  },

  // git-merge: only for git-write commands containing merge
  {
    match: (_t, _p, parsed) => {
      if (!parsed) return false;
      if (parsed.category !== "git-write") return false;
      const cmd = parsed.segments.join(" ").toLowerCase();
      return cmd.includes("merge");
    },
    delta: 10,
    reason: "exec git merge command",
    tag: "git-merge",
  },

  // remote-access: based on parsed category
  {
    match: (_t, _p, parsed) => {
      if (!parsed) return false;
      return parsed.category === "remote";
    },
    delta: 10,
    reason: "exec remote access command (ssh, scp, rsync)",
    tag: "remote-access",
  },

  // persistence: based on parsed category
  {
    match: (_t, _p, parsed) => {
      if (!parsed) return false;
      return parsed.category === "persistence";
    },
    delta: 15,
    reason: "exec persistence command (crontab, launchctl, systemctl)",
    tag: "persistence",
  },

  // permissions: based on parsed category
  {
    match: (_t, _p, parsed) => {
      if (!parsed) return false;
      return parsed.category === "permissions";
    },
    delta: 10,
    reason: "exec permissions command (chmod, chown, chgrp)",
    tag: "permissions",
  },

  // package-install: based on parsed category
  {
    match: (_t, _p, parsed) => {
      if (!parsed) return false;
      return parsed.category === "package-mgmt";
    },
    delta: 5,
    reason: "exec package install command",
    tag: "package-install",
  },
];

// ── Non-exec modifiers (unchanged from original) ────────────

const NON_EXEC_MODIFIERS: Modifier[] = [
  // web_fetch external URL
  {
    match: (t, p) => {
      if (t !== "web_fetch") return false;
      const url = typeof p.url === "string" ? p.url : "";
      if (!url) return false;
      // Check if URL is NOT localhost/127.*
      return !/localhost|127\.\d+\.\d+\.\d+/i.test(url);
    },
    delta: 10,
    reason: "web_fetch URL is external (not localhost/127)",
    tag: "external-network",
  },

  // write/edit path modifiers
  {
    match: (t, p) => (t === "write" || t === "edit") && pathMatches(p, ".env"),
    delta: 20,
    reason: "write/edit path matches .env",
    tag: "credential-access",
  },
  {
    match: (t, p) => (t === "write" || t === "edit") && pathMatches(p, ".ssh"),
    delta: 20,
    reason: "write/edit path matches .ssh",
    tag: "credential-access",
  },
  {
    match: (t, p) => (t === "write" || t === "edit") && pathMatches(p, "/etc/", "/usr/"),
    delta: 25,
    reason: "write/edit path matches /etc/ or /usr/",
    tag: "system-file",
  },
  {
    match: (t, p) => (t === "write" || t === "edit") && pathMatches(p, ".git/"),
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
  llmEvalThreshold: number = 50,
): RiskScore {
  const modifiers: Array<{ reason: string; delta: number }> = [];
  const tags: string[] = [];

  let base: number;
  let parsed: ParsedExecCommand | undefined;

  if (toolName === "exec") {
    // Sub-classify exec commands using the parser
    const command = typeof params.command === "string" ? params.command : "";
    parsed = parseExecCommand(command);
    base = EXEC_BASE_SCORES[parsed.category];
  } else {
    base = BASE_SCORES[toolName] ?? DEFAULT_BASE;
  }

  let score = base;

  // Apply exec-specific modifiers (use parsed command info)
  if (toolName === "exec" && parsed) {
    for (const mod of EXEC_MODIFIERS) {
      if (mod.match(toolName, params, parsed)) {
        modifiers.push({ reason: mod.reason, delta: mod.delta });
        tags.push(mod.tag);
        score += mod.delta;
      }
    }
  }

  // Apply non-exec modifiers
  for (const mod of NON_EXEC_MODIFIERS) {
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
