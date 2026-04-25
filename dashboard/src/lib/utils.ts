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
  const PALETTE = [
    "#6366f1", "#8b5cf6", "#ec4899", "#f97316",
    "#14b8a6", "#06b6d4", "#84cc16", "#f43f5e",
    "#d4a574", "#60a5fa",
  ];
  const h = Math.abs(hashCode(agentId));
  const c1 = PALETTE[h % PALETTE.length];
  const c2 = PALETTE[(h * 7 + 3) % PALETTE.length];
  return [c1, c2 === c1 ? PALETTE[(h + 1) % PALETTE.length] : c2];
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

/** Tag for each non-exec tool. Covers all tool names in TOOL_TO_CATEGORY. */
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
};

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
    const tag = TOOL_TAGS[entry.toolName];
    if (tag) base.push(tag);
    else if (entry.toolName) base.push(entry.toolName);
  }

  return [...extra, ...base].slice(0, 3);
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
}): { path: string; color: string } {
  const meta = CATEGORY_META[entry.category];
  const defaultIcon = { path: meta?.iconPath ?? "", color: meta?.color ?? "var(--cl-text-muted)" };

  // Non-exec tools use their activity category icon
  if (entry.toolName !== "exec" || !entry.execCategory) return defaultIcon;

  // Exec tools: check for sub-category override
  const override = EXEC_ICON_OVERRIDES[entry.execCategory];
  return override ?? defaultIcon;
}
