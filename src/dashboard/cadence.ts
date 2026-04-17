/**
 * Cadence inference — derive a human-readable schedule label from cron
 * session starts. Shared between backend (populates `AgentInfo.schedule`)
 * and frontend (fleet-chart labels via `dashboard/src/lib/utils.ts`).
 */

const SEC = 1000;
const MIN = 60 * SEC;
const HR = 60 * MIN;
const DAY = 24 * HR;

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
