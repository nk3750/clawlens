import type { ActivityCategory, RiskTier, RiskPosture } from "./types";

/** Fallback id for entries whose agentId is not set — must match backend's DEFAULT_AGENT_ID. */
export const DEFAULT_AGENT_ID = "default";

export function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * Compact relative time — no trailing "ago", collapsed units.
 * Used by LiveFeed's two-line rows where the time chip needs to stay
 * narrow (spec §5).
 *   2s, 14s, 1m, 44m, 1h, 2h, 3d, then absolute date after 7d.
 */
export function relTimeCompact(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.floor(diff / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString();
}

// ── Schedule cadence (mirror of src/dashboard/cadence.ts) ──

const CADENCE_SEC = 1000;
const CADENCE_MIN = 60 * CADENCE_SEC;
const CADENCE_HR = 60 * CADENCE_MIN;
const CADENCE_DAY = 24 * CADENCE_HR;

/**
 * Derive a human-readable schedule label from recent cron session starts.
 * Used by the fleet chart + any UI that needs to show cadence client-side.
 * Keep semantics identical to the backend implementation.
 */
export function deriveScheduleLabel(
  mode: "interactive" | "scheduled",
  recentCronStarts: string[],
  explicitSchedule?: string,
): string | null {
  if (explicitSchedule) return explicitSchedule;
  if (mode !== "scheduled") return null;
  if (recentCronStarts.length < 2) return null;

  const sorted = [...recentCronStarts].sort((a, b) => b.localeCompare(a));
  const intervals: number[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const diff = new Date(sorted[i]).getTime() - new Date(sorted[i + 1]).getTime();
    if (diff > 0) intervals.push(diff);
  }
  if (intervals.length === 0) return null;

  intervals.sort((a, b) => a - b);
  const median = intervals[Math.floor(intervals.length / 2)];
  return formatCadenceInterval(median);
}

function formatCadenceInterval(ms: number): string {
  if (ms < CADENCE_MIN) {
    return `every ${Math.max(1, Math.round(ms / CADENCE_SEC))}s`;
  }
  if (ms < CADENCE_HR) {
    return `every ${Math.round(ms / CADENCE_MIN)}m`;
  }
  if (ms < 22 * CADENCE_HR) {
    return `every ${Math.round(ms / CADENCE_HR)}h`;
  }
  if (ms < 26 * CADENCE_HR) return "daily";
  return `every ${Math.round(ms / CADENCE_DAY)}d`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "\u2014";
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m}m ${rem}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function riskTierFromScore(score: number): RiskTier {
  if (score > 75) return "critical";
  if (score > 50) return "high";
  if (score > 25) return "medium";
  return "low";
}

// Compound-rule thresholds for `worstMeaningfulTier`. Tuned to filter
// single-call noise on high-tier (count-based) while keeping medium-tier
// share-based since medium calls are common.
const HIGH_TIER_MIN_COUNT = 2;
const MED_TIER_MIN_SHARE = 0.05;

/**
 * Derive the "worst meaningful tier" for a card-level headline.
 * Compound rule: any crit → CRIT; ≥2 high → HIGH; ≥5% med → MED; else LOW.
 * Unlike `riskTierFromScore(avgRiskScore)`, this surfaces outliers instead of
 * hiding them in an average — used for agent-card pills where a single rm -rf
 * in a busy day must drive the headline, not get averaged into oblivion.
 */
export function worstMeaningfulTier(mix: Record<RiskTier, number>): RiskTier {
  const total = mix.low + mix.medium + mix.high + mix.critical;
  if (total <= 0) return "low";
  if (mix.critical >= 1) return "critical";
  if (mix.high >= HIGH_TIER_MIN_COUNT) return "high";
  if (mix.medium / total >= MED_TIER_MIN_SHARE) return "medium";
  return "low";
}

// ── Agent identity (deterministic from ID hash) ──

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return hash;
}

export function agentGradient(agentId: string): [string, string] {
  // Continuous hue from the id hash — 360 slots vs. the old 10-entry palette.
  // 35° offset between c1 and c2 keeps each agent's gradient monochromatic
  // (recognisable hue identity) while still producing a visible falloff.
  // 70/62 + 75/55 saturation/lightness is the "vibrant on dark surface"
  // sweet spot — readable above --cl-bg-02 without washing out at 20px.
  const hue = Math.abs(hashCode(agentId)) % 360;
  const c1 = `hsl(${hue}, 70%, 62%)`;
  const c2 = `hsl(${(hue + 35) % 360}, 75%, 55%)`;
  return [c1, c2];
}

// ── Risk tier color mapping ──

export function riskColor(tier: RiskTier | string | undefined): string {
  switch (tier) {
    case "critical": return "var(--cl-risk-critical)";
    case "high": return "var(--cl-risk-high)";
    case "medium": return "var(--cl-risk-medium)";
    default: return "var(--cl-risk-low)";
  }
}

export function riskColorRaw(tier: RiskTier | string | undefined): string {
  switch (tier) {
    case "critical": return "#ef4444";
    case "high": return "#f87171";
    case "medium": return "#fbbf24";
    default: return "#4ade80";
  }
}

/** Sub-tier opacity for MEDIUM range (26-50). */
export function mediumSubTierOpacity(score: number): number {
  if (score <= 35) return 0.6;
  if (score <= 45) return 0.8;
  return 1.0;
}

/** Inset box-shadow simulating a risk-colored left border (no layout shift). */
export function riskLeftBorder(score: number | undefined): string | undefined {
  if (score == null) return undefined;

  const tier = riskTierFromScore(score);
  const c = riskColorRaw(tier);

  if (tier === "critical") return `inset 3px 0 0 0 ${c}`;
  if (tier === "high") return `inset 3px 0 0 0 ${c}b3`; // 70%
  if (tier === "low") return `inset 3px 0 0 0 ${c}66`; // ~40%

  if (tier === "medium") {
    const op = mediumSubTierOpacity(score);
    const hex = Math.round(op * 255).toString(16).padStart(2, "0");
    if (score >= 46) {
      // Approaching high — full opacity + subtle glow
      return `inset 2px 0 0 0 ${c}, inset 6px 0 8px -4px ${c}30`;
    }
    return `inset 2px 0 0 0 ${c}${hex}`;
  }

  return undefined; // Exhaustive guard — `tier` narrows to `never` here.
}

// ── Live entry merging ──

import type { EntryResponse } from "./types";

/**
 * Merge live SSE entries with initial API entries, deduplicating by toolCallId.
 * Live entries come first (newest-first order).
 */
export function mergeLiveEntries(
  live: EntryResponse[],
  initial: EntryResponse[],
): EntryResponse[] {
  const seen = new Set<string>();
  const result: EntryResponse[] = [];

  for (const e of live) {
    const key = e.toolCallId ?? e.timestamp;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(e);
    }
  }
  for (const e of initial) {
    const key = e.toolCallId ?? e.timestamp;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(e);
    }
  }

  return result;
}

export function postureLabel(posture: RiskPosture): string {
  switch (posture) {
    case "calm": return "Calm";
    case "elevated": return "Elevated";
    case "high": return "High";
    case "critical": return "Critical";
  }
}

// ── Category metadata with SVG icon paths ──

export const CATEGORY_META: Record<
  ActivityCategory,
  { label: string; color: string; iconPath: string }
> = {
  exploring: {
    label: "exploring",
    color: "var(--cl-cat-exploring)",
    // Eye icon (Lucide)
    iconPath: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 9a3 3 0 100 6 3 3 0 000-6z",
  },
  changes: {
    label: "changes",
    color: "var(--cl-cat-changes)",
    // Pencil icon
    iconPath: "M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z",
  },
  git: {
    label: "git",
    color: "var(--cl-cat-git)",
    // Git-branch icon (Lucide) — shared with `EXTRA_ICON_PATHS.git` below so
    // the card strip and LiveFeed entry icon pipeline stay in sync.
    iconPath:
      "M15 22v-4a4.8 4.8 0 00-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 004 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65S8.93 17.38 9 18v4",
  },
  scripts: {
    label: "scripts",
    color: "var(--cl-cat-scripts)",
    // Code-braces icon (Lucide) — shared with `EXTRA_ICON_PATHS.code`.
    iconPath: "M16 18l6-6-6-6 M8 6l-6 6 6 6",
  },
  web: {
    label: "web",
    color: "var(--cl-cat-web)",
    // Globe icon
    iconPath: "M12 2a10 10 0 100 20 10 10 0 000-20z M2 12h20 M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z",
  },
  comms: {
    label: "comms",
    color: "var(--cl-cat-comms)",
    // MessageSquare icon
    iconPath: "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z",
  },
  orchestration: {
    label: "orchestration",
    color: "var(--cl-cat-orchestration)",
    // Lucide `Network` — three connected nodes; reads as "agent fleet" at 14×14.
    // Three rounded squares (top, bottom-left, bottom-right) joined by a bus.
    iconPath:
      "M16 16h6v6h-6z M2 16h6v6H2z M9 2h6v6H9z M5 16v-3a1 1 0 011-1h12a1 1 0 011 1v3 M12 12V8",
  },
  media: {
    label: "media",
    color: "var(--cl-cat-media)",
    // Lucide `Image` — frame + sun + folded corner.
    iconPath:
      "M3 5a2 2 0 012-2h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2z M11 9a2 2 0 11-4 0 2 2 0 014 0z M21 15l-3.086-3.086a2 2 0 00-2.828 0L6 21",
  },
};

export function categoryColor(cat: ActivityCategory): string {
  return CATEGORY_META[cat]?.color ?? "var(--cl-text-muted)";
}

// ── Entry tag derivation ────────────────────────────────
// Exhaustive mappings for every ExecCategory (src/risk/exec-parser.ts)
// and every tool name (src/dashboard/categories.ts TOOL_TO_CATEGORY).
// When riskTags from the scorer exist, those take priority.
// Otherwise we derive tags from exec sub-category or tool type
// so every timeline entry always has visible context.

/** Tag for each exec sub-category. Covers all 15 ExecCategory values. */
const EXEC_CATEGORY_TAGS: Record<string, string> = {
  "read-only": "read-only",
  search: "search",
  "system-info": "system",
  echo: "echo",
  "git-read": "git",
  "git-write": "git-write",
  "network-read": "network",
  "network-write": "network-write",
  scripting: "script",
  "package-mgmt": "package",
  destructive: "destructive",
  permissions: "permissions",
  persistence: "persistence",
  remote: "remote",
  "unknown-exec": "exec",
};

/** Tag for each non-exec tool. Covers all tool names in TOOL_TO_CATEGORY.
 * For tools with a `params.action` discriminator (nodes / canvas / gateway /
 * subagents) the entry here is a fallback — `deriveActionTag` overrides when
 * an action is present. */
const TOOL_TAGS: Record<string, string> = {
  read: "file-read",
  write: "file-write",
  edit: "file-edit",
  grep: "search",
  glob: "scan",
  search: "web-search",
  web_search: "web-search",
  web_fetch: "web-fetch",
  fetch_url: "web-fetch",
  browser: "browser",
  message: "message",
  sessions_spawn: "spawn",
  cron: "schedule",
  process: "process",
  memory_get: "memory",
  memory_search: "memory",

  // changes
  apply_patch: "file-patch",
  gateway: "gateway",

  // web
  x_search: "x-search",

  // scripts
  code_execution: "code-exec",

  // orchestration
  sessions_send: "session-send",
  sessions_yield: "session-yield",
  sessions_history: "session-history",
  sessions_list: "session-list",
  session_status: "session-status",
  agents_list: "agents-list",
  update_plan: "plan-update",
  subagents: "subagents",

  // media
  image: "image-analyze",
  image_generate: "image-gen",
  video_generate: "video-gen",
  music_generate: "music-gen",
  tts: "tts",
  pdf: "pdf",
  canvas: "canvas",
  nodes: "node",
};

/** Action-aware tag override for the four tools whose `params.action`
 * discriminator carries semantic weight. Returns undefined when no action is
 * present so the caller falls through to the toolName-keyed `TOOL_TAGS`
 * entry. Mirrors how exec already routes through `EXEC_CATEGORY_TAGS`. */
function deriveActionTag(toolName: string, action?: string): string | undefined {
  if (!action) return undefined;
  switch (toolName) {
    case "nodes":
      if (action === "camera_snap" || action === "camera_clip") return "camera";
      if (action === "screen_record") return "screen-rec";
      if (action === "system_run") return "node-run";
      if (action === "approve" || action === "reject") return "node-decision";
      if (action === "notify") return "node-notify";
      return "node";
    case "canvas":
      if (action === "snapshot") return "canvas-snap";
      if (action === "eval") return "canvas-eval";
      if (action === "navigate") return "canvas-nav";
      if (action === "present") return "canvas-show";
      if (action === "hide") return "canvas-hide";
      return "canvas";
    case "gateway":
      if (action === "config.update") return "config-write";
      if (action === "config.get") return "config-read";
      if (action === "restart") return "restart";
      return "gateway";
    case "subagents":
      if (action === "kill") return "subagent-kill";
      if (action === "steer") return "subagent-steer";
      if (action === "list") return "subagent-list";
      return "subagents";
    default:
      return undefined;
  }
}

/**
 * Derive display tags for a timeline entry.
 * Priority: decision prepend > scorer riskTags > exec sub-category > tool type.
 *
 * Decision prepend (spec §4): when effectiveDecision is block/timeout/pending,
 * prepend a matching tag so the chip row surfaces intervention state directly.
 *
 * Cap: 3 items total (bumped from 2 to fit decision + 2 context tags).
 */
export function deriveTags(entry: {
  toolName: string;
  execCategory?: string;
  riskTags?: string[];
  effectiveDecision?: string;
  /** Threaded through so action-aware tools (nodes / canvas / gateway /
   * subagents) can surface action-specific tags via `deriveActionTag`. Older
   * call sites that omit this stay backwards-compatible — tag derivation just
   * falls back to the toolName-keyed entry. */
  params?: Record<string, unknown>;
}): string[] {
  const extra: string[] = [];
  if (entry.effectiveDecision === "block") extra.push("blocked");
  else if (entry.effectiveDecision === "timeout") extra.push("timeout");
  else if (entry.effectiveDecision === "pending") extra.push("pending");

  const base: string[] = [];
  if (entry.riskTags && entry.riskTags.length > 0) {
    // Scorer tags take priority (e.g., "exfiltration", "credential-access")
    base.push(...entry.riskTags.slice(0, 2));
  } else if (entry.execCategory) {
    const tag = EXEC_CATEGORY_TAGS[entry.execCategory];
    if (tag) base.push(tag);
  } else {
    const action =
      typeof entry.params?.action === "string" ? entry.params.action : undefined;
    const actionTag = deriveActionTag(entry.toolName, action);
    if (actionTag) {
      base.push(actionTag);
    } else {
      const tag = TOOL_TAGS[entry.toolName];
      if (tag) base.push(tag);
      else if (entry.toolName) base.push(entry.toolName);
    }
  }

  return [...extra, ...base].slice(0, 3);
}

// ── Risk-tag → human sentence (Phase 2.2 expanded panel) ──
//
// Maps known riskTag tokens emitted by the scorer + LLM evaluator to short
// human-readable sentences that surface the *why* behind a risk score in the
// expanded row body. Unknown tags return null and are silently skipped — the
// row already renders them as inline tag pills via deriveTags(), so omission
// here just means "no extra prose for this tag".
//
// Mapping is exhaustive across what the gateway currently emits + the names
// the spec calls out. Adding a new riskTag in the scorer? Add it here too if
// it carries a meaning worth narrating in the panel.
const RISK_TAG_SENTENCES: Record<string, string> = {
  destructive: "Destructive operation.",

  secret: "Credential surface accessed.",
  credentials: "Credential surface accessed.",
  "credential-abuse": "Credential surface accessed.",
  "credential-misuse": "Credential surface accessed.",
  "ssh-key-usage": "Credential surface accessed.",

  "network-external": "External network call.",
  "network-internal": "Internal network call.",
  "network-local": "Internal network call.",

  "git-write": "Modifies remote repository state.",

  privileged: "Privileged execution.",
  "privileged-execution": "Privileged execution.",
  "privilege-escalation": "Privileged execution.",
  "sudo-execution": "Privileged execution.",
  "sudo-escalation": "Privileged execution.",

  recon: "Reconnaissance pattern.",
  reconnaissance: "Reconnaissance pattern.",
  "reconnaissance-pattern": "Reconnaissance pattern.",
  "host-recon": "Reconnaissance pattern.",

  exfiltration: "Possible data exfiltration.",
  "data-exfiltration": "Possible data exfiltration.",
  "file-exfiltration": "Possible data exfiltration.",
  "potential-exfiltration": "Possible data exfiltration.",

  "remote-access": "Remote system access.",
  "lateral-movement": "Lateral movement attempt.",

  "pattern-escalation": "Risk pattern escalation.",

  "persistence-attempt": "Persistence mechanism.",
  "persistence-key": "Persistence mechanism.",
  "persistence-risk": "Persistence mechanism.",
  "persistent-execution": "Persistence mechanism.",
  "background-persistence": "Persistence mechanism.",
  "persistence-indicator": "Persistence mechanism.",
};

export function riskTagSentence(tag: string): string | null {
  return RISK_TAG_SENTENCES[tag] ?? null;
}

// ── Entry icon selection ────────────────────────────────
// Icon overrides for exec sub-categories. Non-exec tools use their
// activity category icon from CATEGORY_META.
// Covers all 15 ExecCategory values with meaningful visual differentiation.

/** Additional SVG icon paths beyond what's in CATEGORY_META */
const EXTRA_ICON_PATHS: Record<string, string> = {
  git: "M15 22v-4a4.8 4.8 0 00-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 004 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65S8.93 17.38 9 18v4",
  warning:
    "M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z M12 9v4 M12 17h.01",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  code: "M16 18l6-6-6-6 M8 6l-6 6 6 6",
  repeat: "M17 1l4 4-4 4 M3 11V9a4 4 0 014-4h14 M7 23l-4-4 4-4 M21 13v2a4 4 0 01-4 4H3",
  server: "M2 2h20v8H2z M2 14h20v8H2z M6 6h.01 M6 18h.01",
  package:
    "M16.5 9.4l-9-5.19 M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 002 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0022 16z M3.27 6.96L12 12.01l8.73-5.05 M12 22.08V12",
};

/** Lucide icon paths used by `toolIconOverride`. Each entry's `<path d>` was
 * hand-pasted from `lucide.dev/icons/<name>` SVG source — same workflow as
 * `EXTRA_ICON_PATHS` above so we don't take a runtime dep on lucide-react.
 * Designed for the 24×24 viewBox used by every other icon in this file. */
const NEW_ICON_PATHS: Record<string, string> = {
  // media bucket
  image:
    "M3 5a2 2 0 012-2h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2z M11 9a2 2 0 11-4 0 2 2 0 014 0z M21 15l-3.086-3.086a2 2 0 00-2.828 0L6 21",
  imageGen:
    "M9.937 15.5A2 2 0 008.5 14.063l-6.135-1.582a.5.5 0 010-.962L8.5 9.936A2 2 0 009.937 8.5l1.582-6.135a.5.5 0 01.963 0L14.063 8.5A2 2 0 0015.5 9.937l6.135 1.581a.5.5 0 010 .964L15.5 14.063a2 2 0 00-1.437 1.437l-1.582 6.135a.5.5 0 01-.963 0z M20 3v4 M22 5h-4 M4 17v2 M5 18H3",
  video:
    "M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z M7 3v18 M3 7.5h4 M3 12h18 M3 16.5h4 M17 3v18 M17 7.5h4 M17 16.5h4",
  music:
    "M9 18V5l12-2v13 M6 21a3 3 0 100-6 3 3 0 000 6z M18 18a3 3 0 100-6 3 3 0 000 6z",
  speaker:
    "M11 5L6 9H2v6h4l5 4z M15.54 8.46a5 5 0 010 7.07 M19.07 4.93a10 10 0 010 14.14",
  document:
    "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8",
  monitor:
    "M10 7.5v5l4-2.5z M2 13a2 2 0 002 2h16a2 2 0 002-2V5a2 2 0 00-2-2H4a2 2 0 00-2 2z M12 17v4 M8 21h8",
  camera:
    "M14.5 4h-5L7 7H4a2 2 0 00-2 2v9a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2h-3l-2.5-3z M15 13a3 3 0 11-6 0 3 3 0 016 0z",
  screen:
    "M22 6a3 3 0 11-6 0 3 3 0 016 0z M22 12v3a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h9 M12 17v4 M8 21h8",

  // orchestration bucket
  network:
    "M16 16h6v6h-6z M2 16h6v6H2z M9 2h6v6H9z M5 16v-3a1 1 0 011-1h12a1 1 0 011 1v3 M12 12V8",
  send: "M3 3l3 9-3 9 19-9z M6 12h13",
  pause:
    "M22 12a10 10 0 11-20 0 10 10 0 0120 0z M10 9v6 M14 9v6",
  history:
    "M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8 M3 3v5h5 M12 7v5l4 2",
  list: "M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01",
  pulse: "M2 12h4l3-9 6 18 3-9h4",
  users:
    "M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2 M13 7a4 4 0 11-8 0 4 4 0 018 0z M22 21v-2a4 4 0 00-3-3.87 M16 3.13a4 4 0 010 7.75",
  todo: "M4 5h4a1 1 0 011 1v4a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1z M3 17l2 2 4-4 M13 6h8 M13 12h8 M13 18h8",

  // changes bucket
  patch:
    "M14.5 22H18a2 2 0 002-2V7l-5-5H6a2 2 0 00-2 2v3 M14 2v6h6 M3 15h6 M6 12v6 M11 18H5",
  cog:
    "M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z M15 12a3 3 0 11-6 0 3 3 0 016 0z",

  // web bucket
  hash: "M4 9h16 M4 15h16 M10 3l-2 18 M16 3l-2 18",

  // scripts bucket
  terminal: "M4 17l6-6-6-6 M12 19h8",
};

/**
 * Per-tool icon override for the 20 tools added by the activity-category-
 * coverage spec (rev 2). Returns `undefined` for any tool not handled here so
 * callers fall back to the activity-category default from `CATEGORY_META`.
 *
 * Action-aware for `nodes` / `canvas` / `gateway` / `subagents`. Severity
 * never bleeds into color — color is bucket-bound across every action so the
 * microbar swatches stay legible. Severity rides the risk score.
 */
function toolIconOverride(
  toolName: string,
  action?: string,
): { path: string; color: string } | undefined {
  switch (toolName) {
    // ── media bucket — color = var(--cl-cat-media) ─────────────────
    case "image":
      return { path: NEW_ICON_PATHS.image, color: "var(--cl-cat-media)" };
    case "image_generate":
      return { path: NEW_ICON_PATHS.imageGen, color: "var(--cl-cat-media)" };
    case "video_generate":
      return { path: NEW_ICON_PATHS.video, color: "var(--cl-cat-media)" };
    case "music_generate":
      return { path: NEW_ICON_PATHS.music, color: "var(--cl-cat-media)" };
    case "tts":
      return { path: NEW_ICON_PATHS.speaker, color: "var(--cl-cat-media)" };
    case "pdf":
      return { path: NEW_ICON_PATHS.document, color: "var(--cl-cat-media)" };
    case "canvas":
      if (action === "snapshot") {
        return { path: NEW_ICON_PATHS.camera, color: "var(--cl-cat-media)" };
      }
      return { path: NEW_ICON_PATHS.monitor, color: "var(--cl-cat-media)" };
    case "nodes":
      if (action === "camera_snap" || action === "camera_clip") {
        return { path: NEW_ICON_PATHS.camera, color: "var(--cl-cat-media)" };
      }
      if (action === "screen_record") {
        return { path: NEW_ICON_PATHS.screen, color: "var(--cl-cat-media)" };
      }
      if (action === "status" || action === "describe" || action === "pending") {
        return { path: NEW_ICON_PATHS.pulse, color: "var(--cl-cat-media)" };
      }
      return { path: NEW_ICON_PATHS.monitor, color: "var(--cl-cat-media)" };

    // ── orchestration bucket — color = var(--cl-cat-orchestration) ─
    case "sessions_send":
      return { path: NEW_ICON_PATHS.send, color: "var(--cl-cat-orchestration)" };
    case "sessions_yield":
      return { path: NEW_ICON_PATHS.pause, color: "var(--cl-cat-orchestration)" };
    case "sessions_history":
      return { path: NEW_ICON_PATHS.history, color: "var(--cl-cat-orchestration)" };
    case "sessions_list":
      return { path: NEW_ICON_PATHS.list, color: "var(--cl-cat-orchestration)" };
    case "session_status":
      return { path: NEW_ICON_PATHS.pulse, color: "var(--cl-cat-orchestration)" };
    case "agents_list":
      return { path: NEW_ICON_PATHS.users, color: "var(--cl-cat-orchestration)" };
    case "subagents":
      return { path: NEW_ICON_PATHS.users, color: "var(--cl-cat-orchestration)" };
    case "update_plan":
      return { path: NEW_ICON_PATHS.todo, color: "var(--cl-cat-orchestration)" };
    // sessions_spawn falls through to the orchestration category default
    // (Network icon via CATEGORY_META.orchestration). Operators differentiate
    // via the tag column.

    // ── changes bucket — color = var(--cl-cat-changes) ─────────────
    case "apply_patch":
      return { path: NEW_ICON_PATHS.patch, color: "var(--cl-cat-changes)" };
    case "gateway":
      return { path: NEW_ICON_PATHS.cog, color: "var(--cl-cat-changes)" };

    // ── web bucket — color = var(--cl-cat-web) ─────────────────────
    case "x_search":
      return { path: NEW_ICON_PATHS.hash, color: "var(--cl-cat-web)" };

    // ── scripts bucket — color = var(--cl-cat-scripts) ─────────────
    case "code_execution":
      return { path: NEW_ICON_PATHS.terminal, color: "var(--cl-cat-scripts)" };

    default:
      return undefined;
  }
}

/**
 * Exec sub-category → icon override mapping. Covers all 15 ExecCategory values.
 * Returns { path, color } for SVG rendering, or undefined to use the default
 * category icon from CATEGORY_META.
 */
const EXEC_ICON_OVERRIDES: Record<string, { path: string; color: string } | undefined> = {
  "network-read": { path: CATEGORY_META.web.iconPath, color: CATEGORY_META.web.color },
  "network-write": { path: CATEGORY_META.web.iconPath, color: CATEGORY_META.web.color },
  "read-only": { path: CATEGORY_META.exploring.iconPath, color: CATEGORY_META.exploring.color },
  search: { path: CATEGORY_META.exploring.iconPath, color: CATEGORY_META.exploring.color },
  "git-read": { path: EXTRA_ICON_PATHS.git, color: "var(--cl-cat-git)" },
  "git-write": { path: EXTRA_ICON_PATHS.git, color: "var(--cl-cat-changes)" },
  destructive: { path: EXTRA_ICON_PATHS.warning, color: "var(--cl-risk-high)" },
  permissions: { path: EXTRA_ICON_PATHS.shield, color: "var(--cl-risk-medium)" },
  persistence: { path: EXTRA_ICON_PATHS.repeat, color: "var(--cl-cat-scripts)" },
  remote: { path: EXTRA_ICON_PATHS.server, color: "var(--cl-cat-web)" },
  scripting: { path: EXTRA_ICON_PATHS.code, color: "var(--cl-cat-git)" },
  "package-mgmt": { path: EXTRA_ICON_PATHS.package, color: "var(--cl-cat-git)" },
  // These fall back to the default category icon/color:
  //   system-info → exploring (eye)
  //   echo / unknown-exec → scripts (code-braces)
  "system-info": undefined,
  echo: undefined,
  "unknown-exec": undefined,
};

/**
 * Pick the icon for a timeline entry based on exec sub-category (if exec)
 * or activity category (for all other tools).
 * Exhaustive: handles all exec sub-categories and all activity categories.
 */
export function entryIcon(entry: {
  toolName: string;
  category: ActivityCategory;
  execCategory?: string;
  /** Threaded through so `toolIconOverride` can branch on `params.action` for
   * action-aware tools (nodes / canvas / gateway / subagents). Older callers
   * that omit this stay backwards-compatible — those tools just get their
   * tool-level fallback icon instead of the action-specific one. */
  params?: Record<string, unknown>;
}): { path: string; color: string } {
  const meta = CATEGORY_META[entry.category];
  const defaultIcon = { path: meta?.iconPath ?? "", color: meta?.color ?? "var(--cl-text-muted)" };

  if (entry.toolName === "exec") {
    if (!entry.execCategory) return defaultIcon;
    const override = EXEC_ICON_OVERRIDES[entry.execCategory];
    return override ?? defaultIcon;
  }

  const action =
    typeof entry.params?.action === "string" ? entry.params.action : undefined;
  const toolOverride = toolIconOverride(entry.toolName, action);
  return toolOverride ?? defaultIcon;
}
