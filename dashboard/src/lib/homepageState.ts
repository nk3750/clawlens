import type { StatsResponse } from "./types";

/**
 * "Dormant" = the observatory is plugged in but nobody has ever used it on
 * the window we're viewing. Per homepage-v3-layout-spec §5, this is the first
 * signal we look for: show a single centered panel and skip the normal
 * monitoring sections entirely.
 *
 * Returns null when we don't know yet (stats still loading) so the caller
 * can render children instead of flashing the dormant panel during fetch.
 */
export function isDormant(stats: StatsResponse | null | undefined): boolean | null {
  if (stats == null) return null;
  return stats.total === 0 && stats.activeSessions === 0;
}
