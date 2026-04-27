/**
 * Shared utilities for mapping tool calls to activity categories,
 * computing breakdowns, and generating human-readable descriptions.
 *
 * Used by api.ts (agents, sessions, entries, stats) and routes.ts (SSE).
 */
import { parseExecCommand } from "../risk/exec-parser";
import { parseSessionKey } from "./channel-catalog";
const TOOL_TO_CATEGORY = {
    // exploring — file/state reads only (session reads moved to orchestration)
    read: "exploring",
    search: "exploring",
    glob: "exploring",
    grep: "exploring",
    memory_search: "exploring",
    memory_get: "exploring",
    // changes — file/system mutation
    write: "changes",
    edit: "changes",
    // `cron` here is the scheduling TOOL, not the session channel — rare but
    // mutating (installs a schedule), so it sits alongside write/edit.
    cron: "changes",
    process: "changes",
    apply_patch: "changes",
    // gateway: config.update / restart dominate; config.get is rare and stays
    // tinted via the bucket. Severity rides risk score, not color.
    gateway: "changes",
    // web — outbound HTTP / search
    fetch_url: "web",
    web_fetch: "web",
    web_search: "web",
    browser: "web",
    x_search: "web",
    // scripts — running code
    code_execution: "scripts",
    // comms — agent ↔ human only (sessions_spawn moved out)
    message: "comms",
    // orchestration — agent ↔ agent (NEW BUCKET)
    sessions_spawn: "orchestration",
    sessions_send: "orchestration",
    sessions_yield: "orchestration",
    sessions_history: "orchestration",
    sessions_list: "orchestration",
    session_status: "orchestration",
    subagents: "orchestration",
    agents_list: "orchestration",
    update_plan: "orchestration",
    // media — non-code artifacts (NEW BUCKET)
    image: "media",
    image_generate: "media",
    video_generate: "media",
    music_generate: "media",
    tts: "media",
    pdf: "media",
    canvas: "media",
    nodes: "media",
    // exec → routed by sub-category in EXEC_CATEGORY_TO_CATEGORY. No entry here.
};
/** Exec sub-category → activity bucket. Covers all 15 ExecCategory values. */
const EXEC_CATEGORY_TO_CATEGORY = {
    "read-only": "exploring",
    search: "exploring",
    "system-info": "exploring",
    echo: "scripts",
    "git-read": "git",
    "git-write": "git",
    "network-read": "web",
    "network-write": "web",
    // ssh/scp/rsync — talking to other machines over the network, reviewer's
    // `web` mental bucket. Low volume in practice.
    remote: "web",
    scripting: "scripts",
    "package-mgmt": "scripts",
    // destructive / permissions / persistence are filesystem or system-state
    // mutations. Card reading `changes X%` with a red microbar slice signals
    // "some of those changes were high-tier" — the two axes compose cleanly.
    destructive: "changes",
    permissions: "changes",
    persistence: "changes",
    "unknown-exec": "scripts",
};
export function getCategory(toolName, execCategory) {
    if (toolName === "exec" && execCategory) {
        return EXEC_CATEGORY_TO_CATEGORY[execCategory] ?? "scripts";
    }
    return TOOL_TO_CATEGORY[toolName] ?? "scripts";
}
/**
 * Route a full AuditEntry-shaped record to its activity bucket, deriving the
 * exec sub-category from `params.command` for exec calls. Call sites that
 * carry the full entry should prefer this over `getCategory(toolName)` so
 * exec calls are bucketed by domain (git / changes / web / exploring) rather
 * than always falling into the scripts fallback.
 */
export function getCategoryFromEntry(entry) {
    let ec = entry.execCategory;
    if (!ec && entry.toolName === "exec" && typeof entry.params?.command === "string") {
        ec = parseExecCommand(entry.params.command).category;
    }
    return getCategory(entry.toolName, ec);
}
// ── Category breakdown ───────────────────────────────────
export const ALL_CATEGORIES = [
    "exploring",
    "changes",
    "git",
    "scripts",
    "web",
    "comms",
    "orchestration",
    "media",
];
/**
 * Compute percentage breakdown from a set of entries.
 * Returns percentages that sum to 100 (or all 0 if empty).
 *
 * `exec` entries route by `execCategory` when supplied. If only `params`
 * is provided (AuditEntry shape) we derive the sub-category from
 * `params.command`, so call sites can pass raw AuditEntry arrays without
 * pre-parsing.
 */
export function computeBreakdown(entries) {
    const counts = {
        exploring: 0,
        changes: 0,
        git: 0,
        scripts: 0,
        web: 0,
        comms: 0,
        orchestration: 0,
        media: 0,
    };
    for (const e of entries) {
        let ec = e.execCategory;
        if (!ec && e.toolName === "exec" && typeof e.params?.command === "string") {
            ec = parseExecCommand(e.params.command).category;
        }
        counts[getCategory(e.toolName, ec)]++;
    }
    const total = entries.length;
    if (total === 0)
        return counts;
    // Convert to percentages, ensuring they sum to 100
    const result = {
        exploring: 0,
        changes: 0,
        git: 0,
        scripts: 0,
        web: 0,
        comms: 0,
        orchestration: 0,
        media: 0,
    };
    let assigned = 0;
    let largestCat = "exploring";
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
export function parseSessionContext(sessionKey) {
    const parsed = parseSessionKey(sessionKey);
    if (!parsed)
        return undefined;
    const { channel, subPath } = parsed;
    if (channel.id === "cron" && subPath.length > 0) {
        return `Cron: ${humanizeJobName(subPath.join(":"))}`;
    }
    if (channel.id === "main")
        return "Direct session";
    if (channel.id === "heartbeat")
        return "Heartbeat";
    if (channel.id === "subagent")
        return "Subagent";
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
function humanizeJobName(raw) {
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
export function describeAction(entry) {
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
            if (!url)
                return "Web fetch";
            return `Fetch: ${extractUrlDomain(url)}`;
        }
        case "message": {
            const to = typeof params.to === "string" ? params.to : "";
            return to ? `Message ${truncate(to, 30)}` : "Send message";
        }
        case "exec": {
            const cmd = typeof params.command === "string" ? params.command : "";
            if (!cmd)
                return "Run command";
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
        // ── changes ────────────────────────────────────────────
        case "apply_patch": {
            const path = extractFirstPatchPath(typeof params.patch === "string" ? params.patch : "");
            return path ? `Patch: ${path}` : "Patch file";
        }
        case "gateway": {
            const action = typeof params.action === "string" ? params.action : "";
            const path = typeof params.path === "string"
                ? params.path
                : typeof params.key === "string"
                    ? params.key
                    : "";
            if (action === "config.update")
                return path ? `Gateway update: ${path}` : "Gateway update";
            if (action === "config.get")
                return path ? `Gateway query: ${path}` : "Gateway query";
            if (action === "restart")
                return "Gateway restart";
            return action ? `Gateway: ${action}` : "Gateway";
        }
        // ── web ────────────────────────────────────────────────
        case "x_search": {
            const q = typeof params.query === "string" ? params.query : "";
            return q ? `X search "${truncate(q, 40)}"` : "X search";
        }
        // ── scripts ────────────────────────────────────────────
        case "code_execution": {
            const code = typeof params.code === "string"
                ? params.code
                : typeof params.command === "string"
                    ? params.command
                    : "";
            return code ? `Run code: "${truncate(code, 40)}"` : "Run code";
        }
        // ── media ──────────────────────────────────────────────
        case "image":
        case "pdf": {
            const label = toolName === "pdf" ? "PDF" : "Image";
            const target = typeof params.path === "string"
                ? params.path
                : typeof params.file_path === "string"
                    ? params.file_path
                    : typeof params.url === "string"
                        ? params.url
                        : "";
            const prompt = typeof params.prompt === "string" ? params.prompt : "";
            if (target && prompt)
                return `${label}: ${target} — "${truncate(prompt, 30)}"`;
            if (target)
                return `${label}: ${target}`;
            if (prompt)
                return `${label}: "${truncate(prompt, 40)}"`;
            return label;
        }
        case "image_generate":
        case "video_generate":
        case "music_generate":
        case "tts": {
            const verb = toolName === "tts" ? "Speak" : `Generate ${toolName.replace("_generate", "")}`;
            const prompt = typeof params.prompt === "string"
                ? params.prompt
                : typeof params.text === "string"
                    ? params.text
                    : "";
            return prompt ? `${verb}: "${truncate(prompt, 40)}"` : verb;
        }
        case "canvas": {
            const action = typeof params.action === "string" ? params.action : "";
            const url = typeof params.url === "string" ? params.url : "";
            const format = typeof params.format === "string" ? params.format : "";
            if (action === "navigate")
                return url ? `Canvas navigate: ${url}` : "Canvas navigate";
            if (action === "snapshot")
                return format ? `Canvas snapshot: ${format}` : "Canvas snapshot";
            return action ? `Canvas: ${action}` : "Canvas";
        }
        case "nodes": {
            const action = typeof params.action === "string" ? params.action : "";
            const node = typeof params.node === "string"
                ? params.node
                : typeof params.target === "string"
                    ? params.target
                    : "";
            if (action === "system_run") {
                const command = typeof params.command === "string" ? params.command : "";
                if (node && command)
                    return `Nodes ${node}: ${truncate(command, 30)}`;
                if (command)
                    return `Nodes: ${truncate(command, 30)}`;
                if (node)
                    return `Nodes run: ${node}`;
                return "Nodes run";
            }
            if (action === "camera_snap" || action === "camera_clip") {
                return node ? `Nodes camera: ${node}` : "Nodes camera";
            }
            if (action === "screen_record") {
                return node ? `Nodes screen: ${node}` : "Nodes screen";
            }
            if (action)
                return node ? `Nodes ${action}: ${node}` : `Nodes: ${action}`;
            return "Nodes";
        }
        // ── orchestration ──────────────────────────────────────
        case "sessions_send": {
            const target = typeof params.sessionKey === "string"
                ? params.sessionKey
                : typeof params.label === "string"
                    ? params.label
                    : typeof params.agentId === "string"
                        ? params.agentId
                        : "";
            const msg = typeof params.message === "string" ? params.message : "";
            if (target && msg)
                return `Send to ${target}: "${truncate(msg, 30)}"`;
            if (msg)
                return `Send: "${truncate(msg, 40)}"`;
            if (target)
                return `Send to ${target}`;
            return "Send message";
        }
        case "sessions_yield": {
            const target = typeof params.sessionKey === "string"
                ? params.sessionKey
                : typeof params.label === "string"
                    ? params.label
                    : "";
            return target ? `Yield ${target}` : "Yield session";
        }
        case "session_status": {
            const target = typeof params.sessionKey === "string"
                ? params.sessionKey
                : typeof params.label === "string"
                    ? params.label
                    : typeof params.agentId === "string"
                        ? params.agentId
                        : "";
            return target ? `Status ${target}` : "Session status";
        }
        case "sessions_history": {
            const target = typeof params.sessionKey === "string"
                ? params.sessionKey
                : typeof params.label === "string"
                    ? params.label
                    : typeof params.agentId === "string"
                        ? params.agentId
                        : "";
            return target ? `History ${target}` : "Session history";
        }
        case "sessions_list": {
            const target = typeof params.sessionKey === "string"
                ? params.sessionKey
                : typeof params.label === "string"
                    ? params.label
                    : "";
            return target ? `List sessions: ${target}` : "List sessions";
        }
        case "agents_list":
            return "List agents";
        case "subagents": {
            const action = typeof params.action === "string" ? params.action : "";
            const target = typeof params.target === "string" ? params.target : "";
            if (action === "kill")
                return target ? `Kill subagent ${target}` : "Kill subagent";
            if (action === "steer")
                return target ? `Steer subagent ${target}` : "Steer subagent";
            if (action === "list")
                return "List subagents";
            if (action)
                return target ? `Subagent ${action}: ${target}` : `Subagent ${action}`;
            return target ? `Subagent ${target}` : "Subagents";
        }
        case "update_plan": {
            // Schema verified at openclaw `update-plan-tool.ts:11-32`:
            //   { explanation?: string; plan: { step: string; status: "pending" | "in_progress" | "completed" }[] }
            // The most useful description is the in-progress step text — that's
            // the operator's current focus. Falls back through first step →
            // explanation → bare label.
            const plan = Array.isArray(params.plan) ? params.plan : null;
            const explanation = typeof params.explanation === "string" ? params.explanation : "";
            if (!plan || plan.length === 0) {
                return explanation ? `Plan: ${truncate(explanation, 40)}` : "Plan";
            }
            const inProgress = plan.find((s) => typeof s === "object" &&
                s !== null &&
                s.status === "in_progress");
            const focusStep = inProgress
                ? typeof inProgress.step === "string"
                    ? inProgress.step
                    : ""
                : typeof plan[0] === "object" && plan[0] !== null
                    ? typeof plan[0].step === "string"
                        ? plan[0].step
                        : ""
                    : "";
            if (focusStep)
                return `Plan: "${truncate(focusStep, 40)}"`;
            if (explanation)
                return `Plan: ${truncate(explanation, 40)}`;
            return "Plan";
        }
        default:
            return toolName;
    }
}
/**
 * Pull the first path from a unified-diff `patch` blob. Tolerant of both
 * unified-diff `--- a/path` headers and Codex-style `*** Update File: …` /
 * `*** Add File: …` / `*** Delete File: …` headers. Returns "" when no path
 * is recognizable — caller falls back to a bare label.
 *
 * Mirrors the helper of the same name in `dashboard/src/lib/eventFormat.ts`.
 * Duplicated rather than imported because categories.ts is backend code and
 * the dashboard module sits across the SPA boundary; the regex is small and
 * the dual-source-of-truth between describeAction and formatEventTarget is a
 * known follow-up (see issue #44 body).
 */
function extractFirstPatchPath(patch) {
    if (!patch)
        return "";
    const m = patch.match(/^[-+]{3}\s+[ab]\/(\S+)/m) ??
        patch.match(/^\*\*\*\s+(?:Update|Add|Delete)\s+File:\s+(\S+)/m);
    return m ? m[1] : "";
}
function describeExecAction(cmd) {
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
function extractUrlDomain(url) {
    const localMatch = url.match(/^(localhost|127\.\d+\.\d+\.\d+)(:\d+)?/);
    if (localMatch)
        return localMatch[0];
    try {
        const u = new URL(url.startsWith("http") ? url : `https://${url}`);
        return truncate(u.hostname, 45);
    }
    catch {
        return truncate(url, 45);
    }
}
function firstNonFlagArg(rest) {
    for (const t of rest.split(/\s+/)) {
        if (t.length > 0 && !t.startsWith("-"))
            return t;
    }
    return undefined;
}
function lastSegment(path) {
    const parts = path.split("/");
    return parts[parts.length - 1] || path;
}
function extractPath(value) {
    if (typeof value !== "string" || !value)
        return undefined;
    // Show just the filename or last path segment
    const parts = value.split("/");
    const name = parts[parts.length - 1];
    if (parts.length <= 2)
        return value;
    return `.../${parts[parts.length - 2]}/${name}`;
}
function truncate(s, max) {
    if (s.length <= max)
        return s;
    return `${s.slice(0, max - 1)}\u2026`;
}
/**
 * Derive qualitative risk posture from an average risk score.
 *   0-20  → calm
 *   21-45 → elevated
 *   46-70 → high
 *   71+   → critical
 */
export function riskPosture(avgScore) {
    if (avgScore <= 20)
        return "calm";
    if (avgScore <= 45)
        return "elevated";
    if (avgScore <= 70)
        return "high";
    return "critical";
}
//# sourceMappingURL=categories.js.map