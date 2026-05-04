/**
 * Cadence inference — derive a human-readable schedule label from cron
 * session starts. Shared between backend (populates `AgentInfo.schedule`)
 * and frontend (fleet-chart labels via `dashboard/src/lib/utils.ts`).
 */

import type { AuditEntry } from "../audit/logger.js";

const SEC = 1000;
const MIN = 60 * SEC;
const HR = 60 * MIN;
const DAY = 24 * HR;

/**
 * Minimum inter-arrival gap we'll ever treat as a new run boundary.
 * Sub-30s cron intervals are exotic; a floor protects us from
 * over-splitting when an agent happens to have a fast intra-run rhythm.
 */
const MIN_RUN_BOUNDARY_MS = 30 * SEC;

/**
 * Don't climb past this: beyond 30 min we're in "different logical session"
 * territory (see `groupBySessions` / `SESSION_GAP_MS`). Cron runs shouldn't
 * span >30 min in practice.
 */
const MAX_RUN_BOUNDARY_MS = 30 * MIN;

/** Multiplier against a session's own median intra-key gap. */
const RUN_BOUNDARY_FACTOR = 5;

/**
 * Extract one timestamp per cron *run* from a set of audit entries.
 *
 * A single cron invocation produces many tool-call entries separated by
 * the agent's per-call rhythm (a few seconds on fast agents, a minute+ on
 * slow ones). Consecutive runs are separated by the cron schedule interval.
 *
 * We group entries by session key (OpenClaw reuses the key across runs),
 * then split within each group using an **adaptive** threshold:
 *
 *   threshold = clamp( 5 × median_intra_group_gap, 30s, 30min )
 *
 * This adapts to every agent/cron pairing we've seen — a fast agent on a
 * 5-minute cron splits at ~30-50s; a slow agent on an hourly cron splits at
 * minutes — without a user-specific constant.
 */
export function extractCronRunStarts(entries: AuditEntry[]): string[] {
  const byKey = new Map<string, AuditEntry[]>();
  for (const e of entries) {
    if (!e.sessionKey) continue;
    const parts = e.sessionKey.split(":");
    if (parts.length < 3 || parts[2] !== "cron") continue;
    const list = byKey.get(e.sessionKey);
    if (list) list.push(e);
    else byKey.set(e.sessionKey, [e]);
  }

  const runStarts: string[] = [];
  for (const group of byKey.values()) {
    const sorted = [...group].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    if (sorted.length === 0) continue;

    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      gaps.push(
        new Date(sorted[i].timestamp).getTime() - new Date(sorted[i - 1].timestamp).getTime(),
      );
    }

    const medianGap =
      gaps.length > 0 ? [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 0;
    const threshold = Math.min(
      MAX_RUN_BOUNDARY_MS,
      Math.max(MIN_RUN_BOUNDARY_MS, medianGap * RUN_BOUNDARY_FACTOR),
    );

    runStarts.push(sorted[0].timestamp);
    for (let i = 1; i < sorted.length; i++) {
      if (gaps[i - 1] > threshold) runStarts.push(sorted[i].timestamp);
    }
  }

  return runStarts;
}

/**
 * @param mode              "interactive" agents never get a cadence label.
 * @param recentCronStarts  ISO timestamps of recent cron session starts. Order-agnostic.
 * @param explicitSchedule  If provided, returned verbatim (short-circuits inference).
 * @returns "every Nm" / "every Nh" / "daily" / "every Nd" / null when nothing can be inferred.
 */
export function deriveScheduleLabel(
  mode: "interactive" | "scheduled",
  recentCronStarts: string[],
  explicitSchedule?: string,
): string | null {
  if (explicitSchedule) return explicitSchedule;
  if (mode !== "scheduled") return null;
  if (recentCronStarts.length < 2) return null;

  // Sort newest-first so interval diffs are positive.
  const sorted = [...recentCronStarts].sort((a, b) => b.localeCompare(a));
  const intervals: number[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const diff = new Date(sorted[i]).getTime() - new Date(sorted[i + 1]).getTime();
    if (diff > 0) intervals.push(diff);
  }
  if (intervals.length === 0) return null;

  intervals.sort((a, b) => a - b);
  const median = intervals[Math.floor(intervals.length / 2)];
  return formatInterval(median);
}

function formatInterval(ms: number): string {
  if (ms < MIN) {
    return `every ${Math.max(1, Math.round(ms / SEC))}s`;
  }
  if (ms < HR) {
    return `every ${Math.round(ms / MIN)}m`;
  }
  if (ms < 22 * HR) {
    return `every ${Math.round(ms / HR)}h`;
  }
  if (ms < 26 * HR) return "daily";
  return `every ${Math.round(ms / DAY)}d`;
}
