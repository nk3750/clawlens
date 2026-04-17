import type { LlmHealthStatus, RiskPosture } from "../../lib/types";
import type { SSEStatus } from "../../lib/sseStatus";

/** Range options shown in the fleet-header pill group. Canonical order. */
export const RANGE_OPTIONS = ["24h", "12h", "6h", "3h", "1h", "7d"] as const;
export type RangeOption = (typeof RANGE_OPTIONS)[number];

export function isRangeOption(value: unknown): value is RangeOption {
  return typeof value === "string" && (RANGE_OPTIONS as readonly string[]).includes(value);
}

// ── Trend (day-over-day) ─────────────────────────────────────

export type TrendKind = "empty" | "new" | "same" | "up" | "down";

export interface Trend {
  kind: TrendKind;
  /** Human-readable label. Absent when kind === "empty". */
  label?: string;
  /** Absolute percent change. Absent for "empty", "new", or "same". */
  pct?: number;
}

/**
 * Four-state day-over-day trend. Matches spec §10:
 *   - `empty`  both today and yesterday are zero — header skips rendering.
 *   - `new`    yesterday is zero, today has data — no baseline yet.
 *   - `same`   identical — show an em-dash instead of a percent.
 *   - `up|down` with a rounded absolute percent.
 */
export function computeTrend(today: number, yesterday: number): Trend {
  if (yesterday === 0 && today === 0) return { kind: "empty" };
  if (yesterday === 0) return { kind: "new", label: "first day tracking" };
  if (today === yesterday) return { kind: "same", label: "— same as yesterday" };
  const rawPct = ((today - yesterday) / yesterday) * 100;
  const pct = Math.abs(Math.round(rawPct));
  if (rawPct > 0) return { kind: "up", pct, label: `↑ ${pct}% vs yesterday` };
  return { kind: "down", pct, label: `↓ ${pct}% vs yesterday` };
}

// ── Date chip label ──────────────────────────────────────────

/** Produce the label shown on the date chip. `today` / `viewing` are YYYY-MM-DD. */
export function formatDateChipLabel(viewing: string, today: string): string {
  if (viewing === today) return "TODAY";
  const d = new Date(`${viewing}T12:00:00`);
  return d
    .toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
    .toUpperCase();
}

/** Shift an ISO date (YYYY-MM-DD) by N days. Keeps noon-local to dodge DST. */
export function shiftDay(iso: string, delta: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Today in local time as YYYY-MM-DD. Extracted so the helper is callable from tests. */
export function todayLocalISO(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

// ── Retention → usable date range ────────────────────────────

/**
 * Parse a retention string like "30d" / "7d" / "90d" into a day count.
 * Falls back to 30 days if the string is missing or malformed so the calendar
 * still renders a reasonable past-window when config is absent.
 */
export function parseRetentionDays(retention: string | undefined | null): number {
  if (!retention) return 30;
  const match = retention.trim().match(/^(\d+)\s*d$/i);
  if (!match) return 30;
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n <= 0) return 30;
  return Math.floor(n);
}

/** Whether a date chip date picker should allow selection of the given date. */
export function isDateSelectable(iso: string, today: string, retentionDays: number): boolean {
  if (iso > today) return false; // no future
  const earliest = shiftDay(today, -retentionDays);
  return iso >= earliest;
}

export interface QuickDateOption {
  /** YYYY-MM-DD. */
  iso: string;
  /** Short label — "Today", "Yesterday", weekday. */
  label: string;
  disabled: boolean;
}

/**
 * Seven quick-pick buttons shown on top of the date popover: Today, Yesterday,
 * and the five days before that. Retention clamps which dates are selectable.
 */
export function quickDateOptions(today: string, retentionDays: number): QuickDateOption[] {
  const out: QuickDateOption[] = [];
  for (let i = 0; i < 7; i++) {
    const iso = shiftDay(today, -i);
    const d = new Date(`${iso}T12:00:00`);
    let label: string;
    if (i === 0) label = "Today";
    else if (i === 1) label = "Yesterday";
    else label = d.toLocaleDateString("en-US", { weekday: "short" });
    out.push({ iso, label, disabled: !isDateSelectable(iso, today, retentionDays) });
  }
  return out;
}

// ── Quick range spans (for the date popover) ─────────────────

export interface QuickRangeSpan {
  label: string;
  /** Range pill to engage. `null` leaves the current range untouched. */
  range: RangeOption | null;
  /** Days to shift from today. 0 = today, negative = past. */
  dateOffset: number;
}

/**
 * Multi-day quick picks shown below the weekday row in the date popover.
 * Spec §2 of `homepage-v3-stats-strip-spec` calls for "Last 7 days" and
 * "Last 30 days" as range+date shortcuts. §3 only enumerates pills up to 7d,
 * so "Last 30 days" has no matching range — we jump the viewing date 30
 * days back and leave the range untouched.
 */
export function quickRangeSpans(): QuickRangeSpan[] {
  return [
    { label: "Last 7 days", range: "7d", dateOffset: 0 },
    { label: "Last 30 days", range: null, dateOffset: -30 },
  ];
}

// ── Pending count derivation ─────────────────────────────────

export interface InterventionLike {
  effectiveDecision: string;
}

/**
 * Temporary: derive pending approvals from the interventions endpoint.
 * Phase B-2 (attention-inbox spec) replaces this with AttentionResponse.pending.
 * Keep this in one place so the swap is a one-line edit.
 */
export function derivePendingCount(interventions: InterventionLike[] | null | undefined): number {
  if (!interventions) return 0;
  return interventions.filter((i) => i.effectiveDecision === "pending").length;
}

// ── Chip visibility ──────────────────────────────────────────

export function shouldShowBlockedChip(count: number | null | undefined): boolean {
  return typeof count === "number" && count > 0;
}

export function shouldShowPendingChip(count: number | null | undefined): boolean {
  return typeof count === "number" && count > 0;
}

// ── Agents-running breakdown ─────────────────────────────────

export interface RunningBreakdown {
  runningNow: number;
  betweenSessions: number;
}

/**
 * Split "active agents" into two buckets for the tooltip:
 *   - running a session right now  = activeSessions
 *   - active but between sessions   = active agents without an open session
 * Defensive min/max so we never render negative numbers if the two counts
 * disagree transiently across a refresh boundary.
 */
export function splitAgentsRunning(
  activeAgents: number,
  activeSessions: number,
): RunningBreakdown {
  const runningNow = Math.max(0, Math.min(activeSessions, activeAgents));
  const betweenSessions = Math.max(0, activeAgents - runningNow);
  return { runningNow, betweenSessions };
}

// ── Posture ──────────────────────────────────────────────────

export function postureTooltip(posture: RiskPosture): string {
  switch (posture) {
    case "calm":
      return "0 high-risk actions in the last hour";
    case "elevated":
      return "1–2 high-risk actions in the last hour";
    case "high":
      return "3+ high-risk actions; review agents";
    case "critical":
      return "Blocked or pending attention items present";
  }
}

export function postureDotColor(posture: RiskPosture): string {
  switch (posture) {
    case "calm":
      return "var(--cl-risk-low)";
    case "elevated":
      return "var(--cl-risk-medium)";
    case "high":
      return "var(--cl-risk-high)";
    case "critical":
      return "var(--cl-risk-critical)";
  }
}

export function postureLabel(posture: RiskPosture): string {
  switch (posture) {
    case "calm":
      return "CALM";
    case "elevated":
      return "ELEVATED";
    case "high":
      return "HIGH";
    case "critical":
      return "CRITICAL";
  }
}

// ── Health indicator ─────────────────────────────────────────

export type HealthState = "live" | "stale" | "reconnecting" | "offline" | "llm_degraded";

export interface HealthInputs {
  sseStatus: SSEStatus;
  lastEntryIso: string | undefined | null;
  llmStatus: LlmHealthStatus | undefined | null;
  nowMs: number;
}

/**
 * Pick the single "most severe" health state to surface. Priority per spec §8
 * addendum: offline > reconnecting > llm_degraded > stale > live.
 *
 * "stale" kicks in when the newest entry is older than 60s — the gateway is
 * still healthy (SSE is live) but nothing is flowing.
 */
export function computeHealthState({
  sseStatus,
  lastEntryIso,
  llmStatus,
  nowMs,
}: HealthInputs): HealthState {
  if (sseStatus === "offline") return "offline";
  if (sseStatus === "reconnecting") return "reconnecting";
  if (llmStatus === "down" || llmStatus === "degraded") return "llm_degraded";
  const lagSec = lagSeconds(lastEntryIso, nowMs);
  if (lagSec !== null && lagSec > 60) return "stale";
  return "live";
}

/** Seconds since the last audit entry, or null when unknown / un-parseable. */
export function lagSeconds(
  lastEntryIso: string | undefined | null,
  nowMs: number,
): number | null {
  if (!lastEntryIso) return null;
  const then = Date.parse(lastEntryIso);
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.floor((nowMs - then) / 1000));
}

/** Short label for the chrome variant — fits inside a compact header chip. */
export function formatHealthChromeLabel(state: HealthState, lagSec: number | null): string {
  switch (state) {
    case "live": {
      if (lagSec === null) return "live";
      return `live · ${formatLagShort(lagSec)} lag`;
    }
    case "stale": {
      const s = lagSec ?? 0;
      return `stale · ${formatLagShort(s)} lag`;
    }
    case "reconnecting":
      return "reconnecting";
    case "offline":
      return "offline · tap to retry";
    case "llm_degraded":
      return "LLM degraded";
  }
}

/** Longer label for the footer variant — visible real estate is wider. */
export function formatHealthFooterLabel(state: HealthState, lagSec: number | null): string {
  switch (state) {
    case "live":
      return "SSE live";
    case "stale": {
      const s = lagSec ?? 0;
      return `SSE stale · ${formatLagShort(s)} lag`;
    }
    case "reconnecting":
      return "SSE reconnecting";
    case "offline":
      return "SSE offline";
    case "llm_degraded":
      return "LLM degraded";
  }
}

export function healthDotColor(state: HealthState): string {
  switch (state) {
    case "live":
      return "var(--cl-risk-low)";
    case "stale":
      return "var(--cl-risk-medium)";
    case "llm_degraded":
      return "var(--cl-risk-medium)";
    case "reconnecting":
      return "var(--cl-risk-medium)";
    case "offline":
      return "var(--cl-risk-high)";
  }
}

export function formatLagShort(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}
