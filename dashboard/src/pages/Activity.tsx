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
  tierToRiskTier,
  type Filters,
} from "../lib/activityFilters";
import type { AgentInfo, EntryResponse } from "../lib/types";

const DISPLAYED_LIMIT = 50;
const COUNT_BASIS_LIMIT = 200;
const NEW_FLASH_MS = 1800;

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
  if (filters.since) p.set("since", filters.since);
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

  useEffect(() => {
    if (initialDisplayed) setEntries(initialDisplayed);
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

  // Helper: prepend an SSE entry to count basis (always) and to the
  // displayed feed (only when it matches the active filters). Animation
  // tracking is scoped to the displayed feed prepend.
  const applyLiveEntry = useCallback((raw: EntryResponse) => {
    setCountBasis((prev) => [raw, ...prev]);
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
            newIds={newIds}
            paused={paused}
            onTogglePause={togglePause}
            onClear={handleClear}
            onClearAll={handleClearAll}
            onChip={handleChip}
          />
        )}
      </div>
    </div>
  );
}
