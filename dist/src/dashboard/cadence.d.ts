/**
 * Cadence inference — derive a human-readable schedule label from cron
 * session starts. Shared between backend (populates `AgentInfo.schedule`)
 * and frontend (fleet-chart labels via `dashboard/src/lib/utils.ts`).
 */
import type { AuditEntry } from "../audit/logger";
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
export declare function extractCronRunStarts(entries: AuditEntry[]): string[];
/**
 * @param mode              "interactive" agents never get a cadence label.
 * @param recentCronStarts  ISO timestamps of recent cron session starts. Order-agnostic.
 * @param explicitSchedule  If provided, returned verbatim (short-circuits inference).
 * @returns "every Nm" / "every Nh" / "daily" / "every Nd" / null when nothing can be inferred.
 */
export declare function deriveScheduleLabel(mode: "interactive" | "scheduled", recentCronStarts: string[], explicitSchedule?: string): string | null;
