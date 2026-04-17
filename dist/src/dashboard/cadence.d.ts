/**
 * Cadence inference — derive a human-readable schedule label from cron
 * session starts. Shared between backend (populates `AgentInfo.schedule`)
 * and frontend (fleet-chart labels via `dashboard/src/lib/utils.ts`).
 */
/**
 * @param mode              "interactive" agents never get a cadence label.
 * @param recentCronStarts  ISO timestamps of recent cron session starts. Order-agnostic.
 * @param explicitSchedule  If provided, returned verbatim (short-circuits inference).
 * @returns "every Nm" / "every Nh" / "daily" / "every Nd" / null when nothing can be inferred.
 */
export declare function deriveScheduleLabel(mode: "interactive" | "scheduled", recentCronStarts: string[], explicitSchedule?: string): string | null;
