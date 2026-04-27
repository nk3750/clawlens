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

  // changes
  apply_patch: "fs.patch",
  gateway: "system.gateway",

  // web
  x_search: "web.x",

  // scripts
  code_execution: "runtime.exec",

  // orchestration
  sessions_history: "agent.history",
  sessions_list: "agent.list",
  sessions_send: "agent.send",
  sessions_yield: "agent.yield",
  session_status: "agent.status",
  agents_list: "agent.directory",
  update_plan: "agent.plan",
  subagents: "agent.subagents",

  // media
  image: "media.image",
  image_generate: "media.image-gen",
  video_generate: "media.video-gen",
  music_generate: "media.music-gen",
  tts: "media.tts",
  pdf: "media.pdf",
  canvas: "media.canvas",
  nodes: "media.nodes",
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

  // Action-aware namespacing for the rev-2 action-tools. Falls back to the
  // toolName-keyed entry below when no action is present, so a bare
  // `nodes` / `canvas` / `gateway` / `subagents` call still gets a stable
  // namespace label.
  const action = typeof entry.params.action === "string" ? entry.params.action : "";
  if (entry.toolName === "nodes" && action) return `nodes.${action}`;
  if (entry.toolName === "canvas" && action) return `canvas.${action}`;
  if (entry.toolName === "gateway" && action) return `gateway.${action}`;
  if (entry.toolName === "subagents" && action) return `subagents.${action}`;

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

  // changes
  apply_patch: "patched",
  gateway: "configured",

  // web
  x_search: "searched",

  // scripts
  code_execution: "executed",

  // orchestration
  sessions_history: "queried",
  sessions_list: "listed",
  sessions_send: "sent",
  sessions_yield: "yielded",
  session_status: "checked",
  agents_list: "listed",
  update_plan: "planned",
  subagents: "managed",

  // media
  image: "analyzed",
  image_generate: "generated",
  video_generate: "generated",
  music_generate: "generated",
  tts: "spoke",
  pdf: "analyzed",
  canvas: "rendered",
  nodes: "operated",
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

  // Action-aware verbs for the four rev-2 action-tools. Each branch falls
  // through to the tool-level TOOL_VERB entry when the action is unknown so
  // a malformed payload still picks up a sensible verb.
  const action =
    typeof entry.params.action === "string" ? entry.params.action.toLowerCase() : "";
  if (entry.toolName === "nodes" && action) {
    if (action === "camera_snap" || action === "camera_clip") return "captured";
    if (action === "screen_record") return "recorded";
    if (action === "system_run") return "ran";
    if (action === "approve") return "approved";
    if (action === "reject") return "rejected";
    if (action === "notify") return "notified";
    return TOOL_VERB.nodes;
  }
  if (entry.toolName === "canvas" && action) {
    if (action === "snapshot") return "captured";
    if (action === "eval") return "evaluated";
    if (action === "navigate") return "navigated";
    if (action === "hide") return "hid";
    if (action === "present") return "presented";
    return TOOL_VERB.canvas;
  }
  if (entry.toolName === "gateway" && action) {
    if (action === "restart") return "restarted";
    if (action === "config.update") return "configured";
    if (action === "config.get") return "queried";
    return TOOL_VERB.gateway;
  }
  if (entry.toolName === "subagents" && action) {
    if (action === "kill") return "killed";
    if (action === "steer") return "steered";
    if (action === "list") return "listed";
    return TOOL_VERB.subagents;
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

    // ── changes ─────────────────────────────────────────────
    case "apply_patch":
      return extractFirstPatchPath(str(p.patch));
    case "gateway": {
      const action = str(p.action);
      if (action === "config.update" || action === "config.get") {
        return str(p.path) || str(p.key) || "";
      }
      if (action === "restart") return "";
      return action;
    }

    // ── web ─────────────────────────────────────────────────
    case "x_search": {
      const q = str(p.query);
      return q ? `"${q.slice(0, 40)}"` : "";
    }

    // ── scripts ─────────────────────────────────────────────
    case "code_execution": {
      const code = str(p.code) || str(p.command);
      return code ? `"${code.slice(0, 40)}"` : "";
    }

    // ── media ───────────────────────────────────────────────
    case "image":
    case "pdf": {
      const target = str(p.path) || str(p.file_path) || str(p.url);
      const prompt = str(p.prompt);
      if (target && prompt) return `${target} — "${prompt.slice(0, 30)}"`;
      return target || (prompt ? `"${prompt.slice(0, 40)}"` : "");
    }
    case "image_generate":
    case "video_generate":
    case "music_generate":
    case "tts": {
      const prompt = str(p.prompt) || str(p.text);
      return prompt ? `"${prompt.slice(0, 40)}"` : "";
    }
    case "canvas": {
      const action = str(p.action);
      const url = str(p.url);
      if (action === "navigate" && url) return url;
      if (action === "snapshot") return str(p.format) || "snapshot";
      return action || "";
    }
    case "nodes": {
      const action = str(p.action);
      const node = str(p.node) || str(p.target);
      if (action === "system_run") {
        return `${node || "?"}: ${str(p.command).slice(0, 30)}`;
      }
      return node ? `${action || "op"} ${node}` : action;
    }

    // ── orchestration ───────────────────────────────────────
    case "sessions_send": {
      const to = str(p.sessionKey) || str(p.label) || str(p.agentId);
      const msg = str(p.message);
      if (to && msg) return `${to}: "${msg.slice(0, 30)}"`;
      return to || (msg ? `"${msg.slice(0, 40)}"` : "");
    }
    case "sessions_yield":
      return str(p.sessionKey) || str(p.label) || "";
    case "session_status":
    case "sessions_history":
    case "sessions_list":
      return str(p.sessionKey) || str(p.label) || str(p.agentId) || "";
    case "agents_list":
      return "";
    case "subagents": {
      const action = str(p.action) || "list";
      const target = str(p.target);
      return target ? `${action} ${target}` : action;
    }
    case "update_plan": {
      // Schema verified at openclaw `update-plan-tool.ts:11-32`:
      //   { explanation?: string; plan: { step: string; status: "pending" | "in_progress" | "completed" }[] }
      // The most useful target is the in-progress step's text — it's the
      // operator's current focus. Falls back through first step → explanation
      // → bare step count.
      const plan = Array.isArray(p.plan) ? p.plan : null;
      const explanation = str(p.explanation);
      if (!plan || plan.length === 0) return explanation;
      const inProgress = plan.find(
        (s): s is Record<string, unknown> =>
          typeof s === "object" &&
          s !== null &&
          (s as Record<string, unknown>).status === "in_progress",
      );
      const focusStep = inProgress
        ? str(inProgress.step)
        : typeof plan[0] === "object" && plan[0] !== null
          ? str((plan[0] as Record<string, unknown>).step)
          : "";
      const count = plan.length;
      if (focusStep) return `${count} steps · "${focusStep.slice(0, 30)}"`;
      if (explanation) return `${count} steps · ${explanation.slice(0, 30)}`;
      return `${count} steps`;
    }

    default:
      return "";
  }
}

/**
 * Pull the first path from a unified-diff `patch` blob. Returns "" if none.
 * Tolerant of both unified-diff `--- a/path` / `+++ b/path` headers and
 * Codex-style `*** Update File: …` / `*** Add File: …` / `*** Delete File: …`
 * headers. Malformed patches return "" — caller renders just the verb.
 */
function extractFirstPatchPath(patch: string): string {
  if (!patch) return "";
  const m =
    patch.match(/^[-+]{3}\s+[ab]\/(\S+)/m) ??
    patch.match(/^\*\*\*\s+(?:Update|Add|Delete)\s+File:\s+(\S+)/m);
  return m ? m[1] : "";
}
