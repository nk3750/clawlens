import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import ActivityFeed from "../components/activity/ActivityFeed";
import FilterRail from "../components/activity/FilterRail";
import PresetBar from "../components/activity/PresetBar";
import ErrorCard from "../components/ErrorCard";
import { ActivityFeedSkeleton } from "../components/Skeleton";
import { useApi } from "../hooks/useApi";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useSSE } from "../hooks/useSSE";
import { MEDIA_COMPACT, MEDIA_DRAWER, MEDIA_NARROW } from "../lib/breakpoints";
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
  if (filters.q) p.set("q", filters.q);
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

  // Phase 2.9 (#37) — viewport breakpoints. The drawer/compact/narrow flags
  // drive every responsive condition in the activity tree. Pure boolean
  // props beat context for the ≤6-hop tree we have.
  const isMobile = useMediaQuery(MEDIA_DRAWER);
  const isCompact = useMediaQuery(MEDIA_COMPACT);
  const isNarrow = useMediaQuery(MEDIA_NARROW);

  // Drawer state — session-only, no persistence.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement | null>(null);

  // Auto-close the drawer when the viewport widens past the drawer breakpoint
  // — leaving it stuck "open" while in desktop layout would lock the body.
  useEffect(() => {
    if (!isMobile && drawerOpen) setDrawerOpen(false);
  }, [isMobile, drawerOpen]);

  // Body overflow lock — prevents iOS scroll-bounce from fighting the drawer
  // animation, and keeps a long feed from peeking through behind it. The
  // cleanup restores whatever value was there before (most likely empty).
  useEffect(() => {
    if (!drawerOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [drawerOpen]);

  // ESC closes the drawer. The handler is scoped to drawer-open via the
  // `if (!drawerOpen) return` guard above, so it only fires when the drawer
  // is the active modal — there's no other element that would conflict.
  // Conventional dialog behavior: ESC dismisses regardless of focused
  // element. (The drawer auto-focuses its rail search input on open, which
  // would otherwise no-op an input/textarea guard.)
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setDrawerOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  // Hand-rolled focus trap inside the drawer (avoids a focus-trap dependency).
  // Tab from the last focusable wraps to the first; Shift+Tab from the first
  // wraps to the last. Anything else falls through to the browser.
  useEffect(() => {
    if (!drawerOpen) return;
    const drawerEl = drawerRef.current;
    if (!drawerEl) return;
    // Focus the first focusable on open so screen readers announce inside.
    const focusables = drawerEl.querySelectorAll<HTMLElement>(
      'button, [href], input, [tabindex]:not([tabindex="-1"])',
    );
    if (focusables.length > 0) focusables[0].focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const els = drawerEl.querySelectorAll<HTMLElement>(
        'button, [href], input, [tabindex]:not([tabindex="-1"])',
      );
      if (els.length === 0) return;
      const first = els[0];
      const last = els[els.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    drawerEl.addEventListener("keydown", onKey);
    return () => drawerEl.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

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

  // Phase 2.7 (#35) — debounced free-text search. Empty string drops `q`
  // from the URL entirely (no `?q=` left dangling).
  const handleSetQ = useCallback(
    (q: string) => {
      const next: Filters = { ...filtersRef.current };
      if (q) next.q = q;
      else delete next.q;
      writeFilters(next);
    },
    [writeFilters],
  );

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

  const toggleDrawer = useCallback(() => setDrawerOpen((open) => !open), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

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

  const presetWrapperStyle: React.CSSProperties = isCompact
    ? { overflowX: "auto", whiteSpace: "nowrap" }
    : {};

  return (
    <div className="page-enter" style={{ minHeight: "100vh" }}>
      <div className={isCompact ? "scrollbar-hide" : undefined} style={presetWrapperStyle}>
        <PresetBar filters={filters} onSelect={handlePreset} isCompact={isCompact} />
      </div>

      <div
        data-testid="activity-grid"
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "244px 1fr",
          minHeight: "calc(100vh - 92px)",
          gap: 0,
        }}
      >
        {!isMobile && (
          <FilterRail
            filters={filters}
            agents={agents ?? []}
            countBasis={countBasis}
            onSelect={handleSelect}
            onClear={handleClear}
            onApplyFilters={writeFilters}
          />
        )}

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
            onSetQ={handleSetQ}
            isMobile={isMobile}
            isCompact={isCompact}
            isNarrow={isNarrow}
            onToggleDrawer={toggleDrawer}
          />
        )}
      </div>

      {isMobile && drawerOpen && (
        <>
          <div
            data-testid="activity-drawer-backdrop"
            onClick={closeDrawer}
            // Backdrop is decorative; clicks are routed via the explicit
            // div onClick. role="presentation" keeps it out of the AT tree.
            role="presentation"
            style={{
              position: "fixed",
              inset: 0,
              background: "var(--cl-bg-08)",
              zIndex: 50,
            }}
          />
          <aside
            ref={drawerRef}
            data-testid="activity-drawer"
            aria-label="Filter drawer"
            aria-modal="true"
            role="dialog"
            style={{
              position: "fixed",
              left: 0,
              top: 0,
              bottom: 0,
              width: 280,
              maxWidth: "85vw",
              background: "var(--cl-bg-popover)",
              borderRight: "1px solid var(--cl-border-subtle)",
              zIndex: 51,
              overflowY: "auto",
              boxShadow: "0 8px 32px rgba(0, 0, 0, 0.3)",
            }}
          >
            <FilterRail
              filters={filters}
              agents={agents ?? []}
              countBasis={countBasis}
              onSelect={handleSelect}
              onClear={handleClear}
              onApplyFilters={writeFilters}
              isMobile
            />
          </aside>
        </>
      )}
    </div>
  );
}
