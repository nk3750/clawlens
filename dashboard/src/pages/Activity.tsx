import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import ActivityFeed from "../components/activity/ActivityFeed";
import FilterRail from "../components/activity/FilterRail";
import PresetBar from "../components/activity/PresetBar";
import ErrorCard from "../components/ErrorCard";
import { ActivityFeedSkeleton } from "../components/Skeleton";
import { useApi } from "../hooks/useApi";
import { useSSE } from "../hooks/useSSE";
import {
  filtersToSearchParams,
  matchesFilters,
  parseFiltersFromURL,
  prependCapped,
  tierToRiskTier,
  type Filters,
} from "../lib/activityFilters";
import type { AgentInfo, EntryResponse } from "../lib/types";

const API_BASE = "/plugins/clawlens";
const DISPLAYED_LIMIT = 50;
const COUNT_BASIS_LIMIT = 200;
/** Cap on the count basis array so a long-running tab doesn't grow it without bound. */
const COUNT_BASIS_MAX = 500;
const NEW_FLASH_MS = 1800;
/** Default time window for the displayed feed when ?since= is absent. Aligns
 * with the count-basis fetch (also 24h) so the header's "X of Y actions"
 * reads coherently in default state. Operators widen via the rail's time
 * group or ?since= URL — no other UI affordance.
 */
const DEFAULT_SINCE = "24h";

/**
 * Build the API query string for the displayed feed. URL `tier` translates
 * to API `riskTier`; everything else passes through. Unknown tier values
 * (e.g., `?tier=banana`) are dropped from the API call (`tierToRiskTier`
 * returns undefined) — the feed returns no rows, which mirrors what
 * server-side filtering would do.
 */
function buildEntriesQuery(filters: Filters, limit: number, offset: number): string {
  const p = new URLSearchParams();
  p.set("limit", String(limit));
  p.set("offset", String(offset));
  if (filters.agent) p.set("agent", filters.agent);
  if (filters.category) p.set("category", filters.category);
  const rt = tierToRiskTier(filters.tier);
  if (rt) p.set("riskTier", rt);
  if (filters.decision) p.set("decision", filters.decision);
  // Default the displayed feed to the count-basis window (24h) when the
  // operator hasn't picked a time. Keeps "X of Y actions" coherent.
  p.set("since", filters.since ?? DEFAULT_SINCE);
  return p.toString();
}

export default function Activity() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => parseFiltersFromURL(searchParams), [searchParams]);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  // Pause toggles SSE-driven insertion; queued entries flush on resume.
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const queuedRef = useRef<EntryResponse[]>([]);

  // ─── Initial fetches ─────────────────────────────────────
  const displayedQuery = buildEntriesQuery(filters, DISPLAYED_LIMIT, 0);
  const {
    data: initialDisplayed,
    loading: displayedLoading,
    error: displayedError,
    refetch: refetchDisplayed,
  } = useApi<EntryResponse[]>(`api/entries?${displayedQuery}`);

  const countBasisQuery = `since=24h&limit=${COUNT_BASIS_LIMIT}&offset=0`;
  const { data: initialCountBasis } = useApi<EntryResponse[]>(`api/entries?${countBasisQuery}`);

  const { data: agents } = useApi<AgentInfo[]>("api/agents");

  // ─── Local state — displayed feed + count basis + animation tracking ──
  const [entries, setEntries] = useState<EntryResponse[]>([]);
  const [countBasis, setCountBasis] = useState<EntryResponse[]>([]);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  // Reset pagination on filter change. Lives on its own useEffect so it
  // doesn't piggyback on the setEntries effect — the displayedQuery dep
  // captures filter mutations directly and keeps offset in lockstep.
  useEffect(() => {
    setOffset(0);
    setHasMore(true);
  }, [displayedQuery]);

  useEffect(() => {
    if (initialDisplayed) {
      setEntries(initialDisplayed);
      setOffset(initialDisplayed.length);
      setHasMore(initialDisplayed.length >= DISPLAYED_LIMIT);
    }
  }, [initialDisplayed]);

  useEffect(() => {
    if (initialCountBasis) setCountBasis(initialCountBasis);
  }, [initialCountBasis]);

  // ─── SSE — live updates ──────────────────────────────────
  useSSE<EntryResponse>(
    "api/stream",
    useCallback((raw: EntryResponse) => {
      // Pause queues without losing data — flush on resume below.
      if (pausedRef.current) {
        queuedRef.current.push(raw);
        return;
      }
      applyLiveEntry(raw);
    }, []),
  );

  // Helper: prepend an SSE entry to count basis (always, capped via
  // sliding window) and to the displayed feed (only when it matches the
  // active filters). Animation tracking is scoped to the displayed-feed
  // prepend.
  const applyLiveEntry = useCallback((raw: EntryResponse) => {
    setCountBasis((prev) => prependCapped(prev, raw, COUNT_BASIS_MAX));
    if (!matchesFilters(raw, filtersRef.current)) return;
    const id = raw.toolCallId || raw.timestamp;
    setEntries((prev) => [raw, ...prev]);
    setNewIds((prev) => new Set(prev).add(id));
    setTimeout(() => {
      setNewIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, NEW_FLASH_MS);
  }, []);

  // Flush queued entries when paused → false transition occurs.
  useEffect(() => {
    if (paused) return;
    const queued = queuedRef.current;
    if (queued.length === 0) return;
    queuedRef.current = [];
    for (const e of queued) applyLiveEntry(e);
  }, [paused, applyLiveEntry]);

  // ─── Filter mutation helpers ─────────────────────────────
  const writeFilters = useCallback(
    (next: Filters) => {
      setSearchParams(filtersToSearchParams(next), { replace: true });
    },
    [setSearchParams],
  );

  const handleSelect = useCallback(
    (key: keyof Filters, value: string) => {
      const current = filtersRef.current[key];
      const next: Filters = { ...filtersRef.current };
      if (current === value) {
        delete next[key];
      } else {
        next[key] = value;
      }
      writeFilters(next);
    },
    [writeFilters],
  );

  const handleClear = useCallback(
    (key: keyof Filters) => {
      const next: Filters = { ...filtersRef.current };
      delete next[key];
      writeFilters(next);
    },
    [writeFilters],
  );

  const handleClearAll = useCallback(() => writeFilters({}), [writeFilters]);

  const handlePreset = useCallback(
    (preset: { filters: Filters }) => writeFilters(preset.filters),
    [writeFilters],
  );

  const handleChip = useCallback(
    (key: "agent" | "tier", value: string) => {
      // Agent/tier chip clicks always set (never toggle) — operator dragging
      // an attribute up to the filter row is asking to scope, not unscope.
      writeFilters({ ...filtersRef.current, [key]: value });
    },
    [writeFilters],
  );

  const togglePause = useCallback(() => setPaused((p) => !p), []);

  // ─── Pagination — Load more handler ──────────────────────
  // Raw fetch (not useApi) so the next page appends instead of replacing.
  // useApi already issued the first 50 on mount; loadMore runs from offset
  // = current entries.length onward. Errors leave hasMore alone so the
  // operator can retry by clicking Load more again.
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const url = `${API_BASE}/api/entries?${buildEntriesQuery(filters, DISPLAYED_LIMIT, offset)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const more = (await res.json()) as EntryResponse[];
      setEntries((prev) => [...prev, ...more]);
      setOffset((prev) => prev + more.length);
      setHasMore(more.length >= DISPLAYED_LIMIT);
    } catch {
      // Surface as toast in Phase 2.5; for now leave hasMore alone.
    } finally {
      setLoadingMore(false);
    }
  }, [filters, offset, loadingMore, hasMore]);

  return (
    <div className="page-enter" style={{ minHeight: "100vh" }}>
      <PresetBar filters={filters} onSelect={handlePreset} />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "244px 1fr",
          minHeight: "calc(100vh - 92px)",
          gap: 0,
        }}
      >
        <FilterRail
          filters={filters}
          agents={agents ?? []}
          countBasis={countBasis}
          onSelect={handleSelect}
          onClear={handleClear}
        />

        {displayedError && entries.length === 0 ? (
          <div style={{ padding: "24px 32px" }}>
            <ErrorCard message={displayedError} onRetry={refetchDisplayed} />
          </div>
        ) : displayedLoading && entries.length === 0 ? (
          <div style={{ padding: "24px 32px" }}>
            <ActivityFeedSkeleton />
          </div>
        ) : (
          <ActivityFeed
            filters={filters}
            entries={entries}
            totalCount={countBasis.length}
            // SSE prepends can grow countBasis past 200 (capped at
            // COUNT_BASIS_MAX). >= keeps the floor signal correct in
            // either case.
            totalCountAtCap={countBasis.length >= COUNT_BASIS_LIMIT}
            newIds={newIds}
            paused={paused}
            hasMore={hasMore}
            loadingMore={loadingMore}
            onTogglePause={togglePause}
            onClear={handleClear}
            onClearAll={handleClearAll}
            onChip={handleChip}
            onLoadMore={loadMore}
          />
        )}
      </div>
    </div>
  );
}
