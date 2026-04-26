import type { EntryResponse, RiskTier } from "./types";

/**
 * URL-shaped filter state for the Activity page. Lives in the URL via
 * `useSearchParams`; mirrored 1:1 to internal state. The API layer
 * separately translates `tier` → `riskTier` (the backend's name) on the
 * fetch boundary; rail/feed components never see `riskTier`.
 *
 * Field values are kept as `string | undefined` so an unknown URL value
 * (e.g., `?tier=banana`) survives parse → render-as-chip → user-clears,
 * matching the spec's failure-mode contract.
 */
export interface Filters {
  agent?: string;
  category?: string;
  tier?: string;
  decision?: string;
  since?: string;
}

/** Canonical filter keys — order matters for stable URL serialization. */
export const FILTER_KEYS: readonly (keyof Filters)[] = [
  "agent",
  "category",
  "tier",
  "decision",
  "since",
] as const;

export interface Preset {
  id: string;
  label: string;
  filters: Filters;
}

/**
 * URL-driven preset chips above the rail+feed grid (spec §2.1). `all`
 * clears every filter; the others are exact-match shapes against the
 * current filter set. No agent-specific names — these ship in OSS.
 */
export const PRESETS: Preset[] = [
  { id: "all", label: "all", filters: {} },
  { id: "critical-only", label: "critical only", filters: { tier: "critical" } },
  { id: "high-risk-only", label: "high-risk only", filters: { tier: "high" } },
  { id: "pending-approvals", label: "pending approvals", filters: { decision: "pending" } },
  {
    id: "blocks-today",
    label: "blocks today",
    filters: { decision: "block", since: "24h" },
  },
  { id: "last-hour", label: "last hour", filters: { since: "1h" } },
];

/** Validates and narrows a URL `tier` value to the API's `riskTier` union. */
export function tierToRiskTier(tier: string | undefined): RiskTier | undefined {
  if (tier === "low" || tier === "medium" || tier === "high" || tier === "critical") {
    return tier;
  }
  return undefined;
}

/** ms windows for known `since` values. Mirrors backend EntryFilters.since. */
const SINCE_MS: Record<string, number> = {
  "1h": 3_600_000,
  "6h": 21_600_000,
  "24h": 86_400_000,
  "7d": 604_800_000,
};

/**
 * Match a single entry against a Filters set. Mirrors server-side
 * `getRecentEntries` semantics so client-side counts agree with what the
 * API would return for the same filters.
 */
export function matchesFilters(entry: EntryResponse, filters: Filters): boolean {
  if (filters.agent) {
    const id = entry.agentId || "default";
    if (id !== filters.agent) return false;
  }
  if (filters.category) {
    if (entry.category !== filters.category) return false;
  }
  if (filters.tier) {
    if (entry.riskTier !== filters.tier) return false;
  }
  if (filters.decision) {
    if (entry.effectiveDecision !== filters.decision) return false;
  }
  if (filters.since && filters.since !== "all") {
    const ms = SINCE_MS[filters.since];
    // Unknown `since` values silently pass through — matches backend behavior
    // for an `EntryFilters.since` outside the union.
    if (ms != null) {
      const cutoff = Date.now() - ms;
      if (new Date(entry.timestamp).getTime() < cutoff) return false;
    }
  }
  return true;
}

export function applyFilters(entries: EntryResponse[], filters: Filters): EntryResponse[] {
  return entries.filter((e) => matchesFilters(e, filters));
}

export function countWith(entries: EntryResponse[], filters: Filters): number {
  let n = 0;
  for (const e of entries) {
    if (matchesFilters(e, filters)) n++;
  }
  return n;
}

export function parseFiltersFromURL(searchParams: URLSearchParams): Filters {
  const out: Filters = {};
  for (const key of FILTER_KEYS) {
    const v = searchParams.get(key);
    if (v) out[key] = v;
  }
  return out;
}

export function filtersToSearchParams(filters: Filters): URLSearchParams {
  const out = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const v = filters[key];
    if (v) out.set(key, v);
  }
  return out;
}

export function activeFilterCount(filters: Filters): number {
  let n = 0;
  for (const key of FILTER_KEYS) {
    if (filters[key]) n++;
  }
  return n;
}

/**
 * Prepend `item` to the front of `prev` and trim the tail to at most `max`
 * entries. Pure, generic, side-effect free — used by the SSE handler to keep
 * the count basis from growing unbounded over a long-running tab session.
 * `max <= 0` returns an empty array (defensive — caller bug, but no crash).
 */
export function prependCapped<T>(prev: T[], item: T, max: number): T[] {
  if (max <= 0) return [];
  return [item, ...prev].slice(0, max);
}

/**
 * A preset is "active" iff its filter shape exactly equals current
 * filters — every key matches and there are no extras. Empty-string
 * values count as absent (so `{ tier: "high", agent: "" }` matches the
 * `high-risk only` preset).
 */
export function presetMatches(preset: Preset, filters: Filters): boolean {
  const a = filtersToSearchParams(preset.filters).toString();
  const b = filtersToSearchParams(filters).toString();
  return a === b;
}
