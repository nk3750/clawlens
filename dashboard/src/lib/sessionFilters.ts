import type { SessionInfo } from "./types";

/**
 * URL-shaped filter state for the Sessions page (spec §5.7). Mirrors
 * `activityFilters.Filters` semantics — values stay as `string | undefined`
 * so unknown URL values (e.g., `?risk=banana`) survive parse → render-as-chip
 * → user-clears.
 *
 * `view` is a frontend-only client-side narrowing (`live` for active sessions,
 * `blocks` for sessions with blockedCount > 0). v1 keeps these out of the
 * backend per §11.7; promote to API params if they prove load-bearing.
 */
export interface SessionFilters {
  agent?: string;
  risk?: string;
  duration?: string;
  since?: string;
  view?: string;
}

/** Canonical filter keys — order matters for stable URL serialization. */
export const SESSION_FILTER_KEYS: readonly (keyof SessionFilters)[] = [
  "agent",
  "risk",
  "duration",
  "since",
  "view",
] as const;

export interface SessionPreset {
  id: string;
  label: string;
  filters: SessionFilters;
}

/**
 * v1 preset chips (spec §5.3). `live-now` and `with-blocks` apply a
 * client-side narrowing via `view`; `high-risk-only` and `last-hour` map to
 * server-side filters; `all` clears everything.
 */
export const PRESETS: SessionPreset[] = [
  { id: "all", label: "all", filters: {} },
  { id: "live-now", label: "live now", filters: { view: "live" } },
  { id: "high-risk-only", label: "high-risk only", filters: { risk: "high" } },
  { id: "with-blocks", label: "with blocks", filters: { view: "blocks" } },
  { id: "last-hour", label: "last hour", filters: { since: "1h" } },
];

export function parseFiltersFromURL(searchParams: URLSearchParams): SessionFilters {
  const out: SessionFilters = {};
  for (const key of SESSION_FILTER_KEYS) {
    const v = searchParams.get(key);
    if (v) out[key] = v;
  }
  return out;
}

export function filtersToSearchParams(filters: SessionFilters): URLSearchParams {
  const out = new URLSearchParams();
  for (const key of SESSION_FILTER_KEYS) {
    const v = filters[key];
    if (v) out.set(key, v);
  }
  return out;
}

export function activeFilterCount(filters: SessionFilters): number {
  let n = 0;
  for (const key of SESSION_FILTER_KEYS) {
    if (filters[key]) n++;
  }
  return n;
}

/**
 * A preset is "active" iff its filter shape exactly equals current filters —
 * every key matches and there are no extras. Mirrors activityFilters.
 */
export function presetMatches(preset: SessionPreset, filters: SessionFilters): boolean {
  const a = filtersToSearchParams(preset.filters).toString();
  const b = filtersToSearchParams(filters).toString();
  return a === b;
}

/**
 * Client-side narrowing for the `view` filter. Backend params already handle
 * agent / risk / duration / since; this layer only handles the two
 * frontend-only presets per §11.7. Unknown `view` values pass through —
 * matches the forgiveness pattern from activityFilters.
 */
export function applyClientFilter(
  sessions: SessionInfo[],
  filters: SessionFilters,
): SessionInfo[] {
  if (filters.view === "live") {
    return sessions.filter((s) => s.endTime === null);
  }
  if (filters.view === "blocks") {
    return sessions.filter((s) => s.blockedCount > 0);
  }
  return sessions;
}

/**
 * Translate URL filter state into the API query string. Keys map 1:1 to the
 * backend's SessionFilters shape (`risk` → `risk`; `duration` → `duration`;
 * `since` → `since`; `agent` → `agentId`). The frontend-only `view` key is
 * dropped (handled by `applyClientFilter` after the fetch).
 */
export function filtersToApiQuery(
  filters: SessionFilters,
  limit: number,
  offset: number,
): string {
  const p = new URLSearchParams();
  p.set("limit", String(limit));
  p.set("offset", String(offset));
  if (filters.agent) p.set("agentId", filters.agent);
  if (filters.risk) p.set("risk", filters.risk);
  if (filters.duration) p.set("duration", filters.duration);
  if (filters.since) p.set("since", filters.since);
  return p.toString();
}
