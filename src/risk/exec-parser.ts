/**
 * Exec command parser for ClawLens risk scoring.
 *
 * Parses shell command strings into structured data so the scorer
 * can assign category-specific base scores and modifiers can match
 * against parsed tokens instead of raw substrings.
 */

export type ExecCategory =
  | "read-only"
  | "search"
  | "system-info"
  | "echo"
  | "git-read"
  | "git-write"
  | "network-read"
  | "network-write"
  | "scripting"
  | "package-mgmt"
  | "destructive"
  | "permissions"
  | "persistence"
  | "remote"
  | "unknown-exec";

export interface ParsedExecCommand {
  /** The primary command name (e.g., "cat", "curl", "python3") */
  primaryCommand: string;
  /** Category for base score lookup */
  category: ExecCategory;
  /** Flags on the primary command (e.g., ["-rf", "--force"]) */
  flags: string[];
  /** URLs found in the command (for curl/wget) */
  urls: string[];
  /** Whether the command contains a heredoc */
  hasHeredoc: boolean;
  /** The full piped command chain segments */
  segments: string[];
}

/** Base scores per exec category */
export const EXEC_BASE_SCORES: Record<ExecCategory, number> = {
  "read-only": 10,
  search: 10,
  "system-info": 10,
  echo: 5,
  "git-read": 10,
  "git-write": 65,
  "network-read": 45,
  "network-write": 60,
  scripting: 40,
  "package-mgmt": 50,
  destructive: 75,
  permissions: 65,
  persistence: 75,
  remote: 65,
  "unknown-exec": 50,
};

// ── Command classification tables ──────────────────────────────

const READ_ONLY_COMMANDS = new Set([
  "cat",
  "head",
  "tail",
  "less",
  "more",
  "wc",
  "ls",
  "find",
  "tree",
  "file",
  "stat",
  "du",
  "diff",
  "md5sum",
  "sha256sum",
  "xxd",
  "od",
  "strings",
  "readlink",
  "realpath",
  "dirname",
  "basename",
  "tee", // usually read-ish in pipe context
]);

const SEARCH_COMMANDS = new Set(["grep", "rg", "ag", "ack", "fgrep", "egrep"]);

const SYSTEM_INFO_COMMANDS = new Set([
  "uname",
  "whoami",
  "uptime",
  "ps",
  "top",
  "htop",
  "df",
  "env",
  "printenv",
  "date",
  "id",
  "hostname",
  "sw_vers",
  "sysctl",
  "lsof",
  "netstat",
  "ifconfig",
  "ip",
  "which",
  "where",
  "type",
  "command",
]);

const ECHO_COMMANDS = new Set(["echo", "printf"]);

const SCRIPTING_COMMANDS = new Set([
  "python",
  "python3",
  "node",
  "ruby",
  "perl",
  "bash",
  "sh",
  "zsh",
  "deno",
  "bun",
]);

const DESTRUCTIVE_COMMANDS = new Set([
  "rm",
  "rmdir",
  "kill",
  "pkill",
  "killall",
  "shred",
  "truncate",
]);

const PERMISSION_COMMANDS = new Set(["chmod", "chown", "chgrp"]);

const PERSISTENCE_COMMANDS = new Set(["crontab", "launchctl", "systemctl"]);

const REMOTE_COMMANDS = new Set(["ssh", "scp", "rsync"]);

const NETWORK_COMMANDS = new Set(["curl", "wget", "http", "httpie"]);

const PACKAGE_MGR_COMMANDS = new Set([
  "pip",
  "pip3",
  "npm",
  "npx",
  "yarn",
  "pnpm",
  "brew",
  "apt",
  "apt-get",
  "dnf",
  "yum",
  "gem",
  "cargo",
  "go",
]);

/** Package manager subcommands that indicate installation/mutation */
const PACKAGE_INSTALL_SUBCOMMANDS = new Set([
  "install",
  "uninstall",
  "remove",
  "upgrade",
  "update",
  "add",
  "global",
]);

const GIT_READ_SUBCOMMANDS = new Set([
  "status",
  "log",
  "diff",
  "branch",
  "show",
  "stash",
  "tag",
  "remote",
  "fetch",
  "ls-files",
  "describe",
  "blame",
  "shortlog",
  "rev-parse",
  "config",
]);

const GIT_WRITE_SUBCOMMANDS = new Set([
  "push",
  "merge",
  "rebase",
  "reset",
  "commit",
  "checkout",
  "switch",
  "cherry-pick",
  "revert",
  "pull",
  "am",
  "apply",
  "clean",
]);

// ── Prefix stripping ──────────────────────────────────────────

/**
 * Commands that are commonly chained before the "real" command and
 * should be skipped when finding the primary command.
 */
function isSkippablePrefix(token: string): boolean {
  // cd, source/., set, export, pushd, popd, eval, env (the command), sudo, nohup, time
  return /^(cd|source|\.|set|export|pushd|popd|eval|env|sudo|nohup|time|nice|ionice|command)$/.test(
    token,
  );
}

// ── Tokenisation helpers ──────────────────────────────────────

/**
 * Split a command string on `&&` and `;` into sequential segments,
 * respecting quoted strings (single, double, backtick) so that a
 * `&&` inside quotes is not treated as a separator.
 */
function splitChainedCommands(cmd: string): string[] {
  const segments: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let i = 0;

  while (i < cmd.length) {
    const ch = cmd[i];

    // Handle escape sequences
    if (ch === "\\" && i + 1 < cmd.length) {
      current += ch + cmd[i + 1];
      i += 2;
      continue;
    }

    // Track quoting state
    if (ch === "'" && !inDouble && !inBacktick) {
      inSingle = !inSingle;
      current += ch;
      i++;
      continue;
    }
    if (ch === '"' && !inSingle && !inBacktick) {
      inDouble = !inDouble;
      current += ch;
      i++;
      continue;
    }
    if (ch === "`" && !inSingle && !inDouble) {
      inBacktick = !inBacktick;
      current += ch;
      i++;
      continue;
    }

    // Only split when outside quotes
    if (!inSingle && !inDouble && !inBacktick) {
      // `&&`
      if (ch === "&" && i + 1 < cmd.length && cmd[i + 1] === "&") {
        segments.push(current.trim());
        current = "";
        i += 2;
        continue;
      }
      // `;`
      if (ch === ";") {
        segments.push(current.trim());
        current = "";
        i++;
        continue;
      }
    }

    current += ch;
    i++;
  }

  if (current.trim()) {
    segments.push(current.trim());
  }

  return segments.filter((s) => s.length > 0);
}

/**
 * Split a single segment on unquoted pipes (`|`) to get piped commands.
 */
function splitPipes(segment: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let i = 0;

  while (i < segment.length) {
    const ch = segment[i];

    if (ch === "\\" && i + 1 < segment.length) {
      current += ch + segment[i + 1];
      i += 2;
      continue;
    }

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      current += ch;
      i++;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      current += ch;
      i++;
      continue;
    }

    if (!inSingle && !inDouble && ch === "|") {
      // Skip `||` — that's OR, not pipe
      if (i + 1 < segment.length && segment[i + 1] === "|") {
        current += "||";
        i += 2;
        continue;
      }
      parts.push(current.trim());
      current = "";
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts.filter((s) => s.length > 0);
}

/**
 * Tokenise a simple command string into words, respecting quotes.
 * Does NOT handle pipes or `&&` — call on already-split segments.
 */
function tokenize(cmd: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let i = 0;

  while (i < cmd.length) {
    const ch = cmd[i];

    if (ch === "\\" && i + 1 < cmd.length) {
      current += ch + cmd[i + 1];
      i += 2;
      continue;
    }

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      current += ch;
      i++;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      current += ch;
      i++;
      continue;
    }

    if (!inSingle && !inDouble && /\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

// ── URL extraction ────────────────────────────────────────────

const URL_PATTERN =
  /(?:https?:\/\/[^\s'"]+|localhost(?::\d+)?(?:\/[^\s'"]*)?|127\.\d+\.\d+\.\d+(?::\d+)?(?:\/[^\s'"]*)?)/gi;

function extractUrls(command: string): string[] {
  const matches = command.match(URL_PATTERN);
  if (!matches) return [];
  // Clean trailing quotes/parens
  return matches.map((u) => u.replace(/['")\]}>]+$/, ""));
}

// ── Network command analysis ──────────────────────────────────

const CURL_WRITE_FLAGS = new Set(["-d", "--data", "--data-raw", "--data-binary", "--data-urlencode", "-F", "--form"]);

function isNetworkWrite(tokens: string[]): boolean {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    // -X POST/PUT/PATCH/DELETE
    if ((t === "-X" || t === "--request") && i + 1 < tokens.length) {
      const method = tokens[i + 1].toUpperCase();
      if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
        return true;
      }
    }
    // Data flags imply POST
    if (CURL_WRITE_FLAGS.has(t) || CURL_WRITE_FLAGS.has(t.split("=")[0])) {
      return true;
    }
    // wget --post-data, --post-file
    if (t.startsWith("--post")) {
      return true;
    }
  }
  return false;
}

// ── Git subcommand analysis ───────────────────────────────────

function classifyGit(tokens: string[]): ExecCategory {
  // Find the git subcommand (first token after "git" that doesn't start with -)
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.startsWith("-")) continue; // skip flags like -C
    if (GIT_WRITE_SUBCOMMANDS.has(t)) return "git-write";
    if (GIT_READ_SUBCOMMANDS.has(t)) return "git-read";
    // Unknown git subcommand — treat as read to be safe but not alarming
    return "git-read";
  }
  // bare `git` with no subcommand
  return "git-read";
}

// ── Package manager analysis ──────────────────────────────────

function isPackageInstall(tokens: string[]): boolean {
  // Check if any token (after the command name) is an install-type subcommand
  for (let i = 1; i < tokens.length; i++) {
    if (PACKAGE_INSTALL_SUBCOMMANDS.has(tokens[i])) return true;
  }
  return false;
}

// ── Persistence subcommand check ──────────────────────────────

function classifyPersistence(command: string, tokens: string[]): ExecCategory {
  // `systemctl enable` is persistence, `systemctl status` is system-info
  if (command === "systemctl") {
    for (let i = 1; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.startsWith("-")) continue;
      if (t === "status" || t === "is-active" || t === "is-enabled" || t === "list-units" || t === "show") {
        return "system-info";
      }
      break;
    }
  }
  return "persistence";
}

// ── Primary command extraction ─────────────────────────────────

/**
 * Given tokens from a single pipe segment, find the primary command name
 * by skipping env-setup prefixes (cd, source, set, export, etc.) and
 * their arguments, then stripping any path prefix from the command.
 */
function findPrimaryCommand(tokens: string[]): { command: string; remaining: string[] } {
  let i = 0;

  while (i < tokens.length) {
    const tok = tokens[i];

    // Strip leading environment variable assignments: FOO=bar
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tok)) {
      i++;
      continue;
    }

    const baseName = extractBaseName(tok);

    if (!isSkippablePrefix(baseName)) {
      return { command: baseName, remaining: tokens.slice(i) };
    }

    // Skip the prefix and its arguments until the next `&&` or end
    // For `cd`, skip one arg. For `source`, skip one arg. For `set`, skip flags.
    i++; // skip the command itself

    if (baseName === "cd" || baseName === "source" || baseName === ".") {
      // skip one argument (the path/file)
      if (i < tokens.length && !tokens[i].startsWith("-")) {
        i++;
      }
    } else if (baseName === "set") {
      // skip flags like -a, +a, -e, etc.
      while (i < tokens.length && /^[+-]/.test(tokens[i])) {
        i++;
      }
    } else if (baseName === "export") {
      // skip KEY=value
      while (i < tokens.length && /^[A-Za-z_]/.test(tokens[i])) {
        i++;
      }
    } else if (baseName === "sudo" || baseName === "nohup" || baseName === "nice" || baseName === "time" || baseName === "command") {
      // These just prefix the real command — skip no args, next token is the command
      continue;
    } else if (baseName === "env") {
      // env can have VAR=val pairs before the command
      // But bare `env` (no further command) is system-info
      const envStart = i;
      while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) {
        i++;
      }
      // If nothing left after env + VAR=val pairs, `env` is the primary command
      if (i >= tokens.length) {
        return { command: "env", remaining: tokens.slice(envStart - 1) };
      }
    }
    // For pushd/popd/eval, skip all remaining tokens
  }

  return { command: "", remaining: [] };
}

function extractBaseName(token: string): string {
  // Strip path prefix: /opt/homebrew/bin/railway → railway
  const slashIdx = token.lastIndexOf("/");
  const name = slashIdx >= 0 ? token.slice(slashIdx + 1) : token;
  return name;
}

// ── Flag extraction ───────────────────────────────────────────

/**
 * Extract flags from the primary command's tokens, stopping at
 * subcommand boundaries (for git, curl, etc.) and excluding
 * values of flag-argument pairs.
 */
function extractFlags(tokens: string[]): string[] {
  const flags: string[] = [];
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.startsWith("--")) {
      // --flag or --flag=value
      flags.push(t.split("=")[0]);
    } else if (t.startsWith("-") && t.length > 1 && !/^-\d/.test(t)) {
      // -f, -rf, etc. (but not -9 which is a signal)
      flags.push(t);
    }
  }
  return flags;
}

// ── Heredoc detection ─────────────────────────────────────────

function hasHeredoc(command: string): boolean {
  return /<<[-~]?\s*['"]?\w+['"]?/.test(command);
}

// ── Redirect stripping ────────────────────────────────────────

/**
 * Remove common redirections (2>&1, >/dev/null, etc.) from a command
 * string so they don't pollute tokenization.
 */
function stripRedirects(cmd: string): string {
  // Remove 2>&1, 1>&2, >&2 etc.
  let result = cmd.replace(/\d*>&\d+/g, "");
  // Remove > /dev/null, >> file, etc. (simple cases)
  result = result.replace(/[12]?>>\s*\S+/g, "");
  result = result.replace(/[12]?>\s*\/dev\/null/g, "");
  return result;
}

// ── Main parser ───────────────────────────────────────────────

export function parseExecCommand(rawCommand: string): ParsedExecCommand {
  const command = (rawCommand ?? "").trim();

  if (!command) {
    return {
      primaryCommand: "",
      category: "unknown-exec",
      flags: [],
      urls: [],
      hasHeredoc: false,
      segments: [],
    };
  }

  const heredoc = hasHeredoc(command);
  const urls = extractUrls(command);

  // Split on && and ; first to get chained command segments
  const chainedSegments = splitChainedCommands(command);
  // Collect all pipe segments across all chained segments for the `segments` field
  const allSegments: string[] = [];
  for (const seg of chainedSegments) {
    const pipes = splitPipes(seg);
    allSegments.push(...pipes);
  }

  // Find the primary command: walk through chained segments, skip prefixes
  let primaryCommand = "";
  let primaryTokens: string[] = [];

  for (const seg of chainedSegments) {
    const pipeParts = splitPipes(seg);
    // The first pipe segment of the first meaningful chained segment is the primary
    const firstPipe = pipeParts[0];
    if (!firstPipe) continue;

    const cleaned = stripRedirects(firstPipe);
    const tokens = tokenize(cleaned);
    const result = findPrimaryCommand(tokens);

    if (result.command) {
      primaryCommand = result.command;
      primaryTokens = result.remaining;
      break;
    }
    // If this chained segment was all prefixes (e.g., `cd /path`), continue to next
  }

  if (!primaryCommand) {
    return {
      primaryCommand: "",
      category: "unknown-exec",
      flags: [],
      urls,
      hasHeredoc: heredoc,
      segments: allSegments,
    };
  }

  // Classify the command
  const category = classifyCommand(primaryCommand, primaryTokens, command);
  const flags = extractFlags(primaryTokens);

  return {
    primaryCommand,
    category,
    flags,
    urls,
    hasHeredoc: heredoc,
    segments: allSegments,
  };
}

function classifyCommand(
  command: string,
  tokens: string[],
  _fullCommand: string,
): ExecCategory {
  // Normalize command name (handle python3.11 → python3 → python)
  const normalized = command.replace(/\d+(\.\d+)*$/, "");
  const commandLower = command.toLowerCase();
  const normalizedLower = normalized.toLowerCase();

  // Check each category
  if (ECHO_COMMANDS.has(commandLower)) return "echo";
  if (READ_ONLY_COMMANDS.has(commandLower)) return "read-only";
  if (SEARCH_COMMANDS.has(commandLower)) return "search";
  if (SYSTEM_INFO_COMMANDS.has(commandLower)) return "system-info";
  if (DESTRUCTIVE_COMMANDS.has(commandLower)) return "destructive";
  if (PERMISSION_COMMANDS.has(commandLower)) return "permissions";
  if (PERSISTENCE_COMMANDS.has(commandLower)) return classifyPersistence(commandLower, tokens);
  if (REMOTE_COMMANDS.has(commandLower)) return "remote";

  // Git — need subcommand analysis
  if (commandLower === "git") return classifyGit(tokens);

  // Network commands — check read vs write
  if (NETWORK_COMMANDS.has(commandLower)) {
    return isNetworkWrite(tokens) ? "network-write" : "network-read";
  }

  // Scripting — check for -c flag or -m flag etc.
  if (
    SCRIPTING_COMMANDS.has(commandLower) ||
    SCRIPTING_COMMANDS.has(normalizedLower)
  ) {
    return "scripting";
  }

  // Package managers — but only if they have an install-like subcommand
  if (PACKAGE_MGR_COMMANDS.has(commandLower)) {
    if (isPackageInstall(tokens)) return "package-mgmt";
    // `npm run`, `pip list`, etc. are not particularly risky
    return "unknown-exec";
  }

  // sed — check if it's print mode (-n with /p) or modifying
  if (commandLower === "sed") {
    // sed -n is typically read-only (print mode)
    if (tokens.some((t) => t === "-n")) return "search";
    // sed -i is in-place editing
    if (tokens.some((t) => t === "-i" || t.startsWith("-i"))) return "unknown-exec";
    // Plain sed without -i pipes output — read-ish
    return "search";
  }

  // sort, uniq, awk, cut, tr, jq — data transformation, read-only-ish
  if (
    ["sort", "uniq", "awk", "cut", "tr", "jq", "yq", "xargs", "tee"].includes(
      commandLower,
    )
  ) {
    return "read-only";
  }

  // mkdir, touch, cp, mv — moderate mutation
  if (["mkdir", "touch", "cp", "mv", "ln"].includes(commandLower)) {
    return "unknown-exec";
  }

  return "unknown-exec";
}

/**
 * Convenience: get the base score for a parsed exec command.
 */
export function getExecBaseScore(parsed: ParsedExecCommand): number {
  return EXEC_BASE_SCORES[parsed.category];
}

/**
 * Convenience: parse and get category + base score in one call.
 */
export function getExecCategory(command: string): {
  category: ExecCategory;
  baseScore: number;
  parsed: ParsedExecCommand;
} {
  const parsed = parseExecCommand(command);
  return {
    category: parsed.category,
    baseScore: EXEC_BASE_SCORES[parsed.category],
    parsed,
  };
}
