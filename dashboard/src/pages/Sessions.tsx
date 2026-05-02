import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import SessionRow from "../components/sessions/SessionRow";
import SessionsActiveFilterChips from "../components/sessions/SessionsActiveFilterChips";
import SessionsFilterRail from "../components/sessions/SessionsFilterRail";
import SessionsPresetBar from "../components/sessions/SessionsPresetBar";
import ErrorCard from "../components/ErrorCard";
import { useApi } from "../hooks/useApi";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useSessions } from "../hooks/useSessions";
import { MEDIA_DRAWER } from "../lib/breakpoints";
import {
  applyClientFilter,
  filtersToSearchParams,
  parseFiltersFromURL,
  type SessionFilters,
  type SessionPreset,
} from "../lib/sessionFilters";
import type { AgentInfo } from "../lib/types";

const DEFAULT_SINCE = "24h";

export default function Sessions() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo<SessionFilters>(
    () => parseFiltersFromURL(searchParams),
    [searchParams],
  );

  const isMobile = useMediaQuery(MEDIA_DRAWER);

  // Drawer state — session-only, no persistence. Mirrors Activity.tsx.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement | null>(null);

  // Auto-close when the viewport widens past the drawer breakpoint — leaving
  // it stuck open while in desktop layout would lock the body scroll.
  useEffect(() => {
    if (!isMobile && drawerOpen) setDrawerOpen(false);
  }, [isMobile, drawerOpen]);

  // Body overflow lock while the drawer is open.
  useEffect(() => {
    if (!drawerOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [drawerOpen]);

  // ESC closes the drawer.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setDrawerOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  // Hand-rolled focus trap inside the drawer.
  useEffect(() => {
    if (!drawerOpen) return;
    const drawerEl = drawerRef.current;
    if (!drawerEl) return;
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

  const toggleDrawer = useCallback(() => setDrawerOpen((open) => !open), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // Spec §5.7 — set since=24h on first mount when the URL doesn't already
  // include a since param, so refresh / share preserve the default.
  useEffect(() => {
    if (!searchParams.has("since")) {
      const next = new URLSearchParams(searchParams);
      next.set("since", DEFAULT_SINCE);
      setSearchParams(next, { replace: true });
    }
    // Mount-only effect — searchParams ref churns on every URL update.
    // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only default
  }, []);

  const writeFilters = useCallback(
    (next: SessionFilters) => {
      setSearchParams(filtersToSearchParams(next), { replace: true });
    },
    [setSearchParams],
  );

  const handleSelect = useCallback(
    (key: keyof SessionFilters, value: string) => {
      const current = filters[key];
      const next: SessionFilters = { ...filters };
      if (current === value) {
        delete next[key];
      } else {
        next[key] = value;
      }
      writeFilters(next);
      // Mobile UX: collapse the drawer once a filter is picked so the
      // operator immediately sees the narrowed feed. No-op on desktop
      // because the drawer is never open there.
      setDrawerOpen(false);
    },
    [filters, writeFilters],
  );

  const handleClear = useCallback(
    (key: keyof SessionFilters) => {
      const next: SessionFilters = { ...filters };
      delete next[key];
      writeFilters(next);
    },
    [filters, writeFilters],
  );

  const handleClearAll = useCallback(() => writeFilters({}), [writeFilters]);

  const handlePreset = useCallback(
    (preset: SessionPreset) => writeFilters(preset.filters),
    [writeFilters],
  );

  const { data: agents } = useApi<AgentInfo[]>("api/agents");

  const {
    sessions,
    total,
    loading,
    loadingMore,
    hasMore,
    error,
    loadMore,
    refetch,
  } = useSessions(filters);

  // §11.7 — `view=live` / `view=blocks` are frontend client-side narrowings
  // over the fetched page. Done here, not in useSessions, so the count
  // semantics (`X of Y sessions`) stay coherent against the API total.
  const visibleSessions = useMemo(
    () => applyClientFilter(sessions, filters),
    [sessions, filters],
  );

  const showEmpty = !loading && !error && visibleSessions.length === 0;

  return (
    <div className="page-enter" style={{ minHeight: "100vh" }}>
      <SessionsPresetBar filters={filters} onSelect={handlePreset} />

      <div
        data-testid="sessions-grid"
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "244px 1fr",
          minHeight: "calc(100vh - 92px)",
          gap: 0,
        }}
      >
        {!isMobile && (
          <SessionsFilterRail
            filters={filters}
            agents={agents ?? []}
            onSelect={handleSelect}
            onClear={handleClear}
          />
        )}

        <div style={{ padding: "18px 24px 28px" }}>
          <header
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 14,
              marginBottom: 14,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {isMobile && (
                <button
                  type="button"
                  data-testid="sessions-drawer-toggle"
                  aria-label="Open filter drawer"
                  onClick={toggleDrawer}
                  style={{
                    width: 32,
                    height: 32,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "transparent",
                    border: "1px solid var(--cl-border-subtle)",
                    borderRadius: 6,
                    color: "var(--cl-text-secondary)",
                    cursor: "pointer",
                    padding: 0,
                    flexShrink: 0,
                  }}
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <line x1="3" y1="6" x2="21" y2="6" />
                    <line x1="3" y1="12" x2="21" y2="12" />
                    <line x1="3" y1="18" x2="21" y2="18" />
                  </svg>
                </button>
              )}
              <h1
                style={{
                  fontFamily: "var(--cl-font-sans)",
                  fontSize: 18,
                  fontWeight: 510,
                  color: "var(--cl-text-primary)",
                  margin: 0,
                }}
              >
                Sessions
              </h1>
            </div>
            <span
              data-testid="sessions-count"
              className="label-mono"
              style={{ fontSize: 11, color: "var(--cl-text-muted)" }}
            >
              {visibleSessions.length} of {total} sessions
            </span>
          </header>

          <SessionsActiveFilterChips
            filters={filters}
            onClear={handleClear}
            onClearAll={handleClearAll}
          />

          {error && sessions.length === 0 ? (
            <ErrorCard message={error} onRetry={refetch} />
          ) : showEmpty ? (
            <div
              data-testid="sessions-empty"
              style={{
                padding: "40px 0",
                textAlign: "center",
                color: "var(--cl-text-muted)",
                fontSize: 13,
              }}
            >
              {total === 0
                ? "no sessions in this window"
                : "no sessions match these filters"}
              {total > 0 && (
                <div style={{ marginTop: 12 }}>
                  <button
                    type="button"
                    data-testid="sessions-empty-clear"
                    onClick={handleClearAll}
                    className="label-mono"
                    style={{
                      fontSize: 10,
                      padding: "6px 10px",
                      background: "transparent",
                      border: "1px solid var(--cl-border-subtle)",
                      borderRadius: 4,
                      cursor: "pointer",
                      color: "var(--cl-accent)",
                    }}
                  >
                    CLEAR FILTERS
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div data-testid="sessions-feed">
              {visibleSessions.map((s) => (
                <SessionRow key={s.sessionKey} session={s} />
              ))}
              {hasMore && (
                <div style={{ display: "flex", justifyContent: "center", padding: "18px 0" }}>
                  <button
                    type="button"
                    data-testid="sessions-load-more"
                    onClick={loadMore}
                    disabled={loadingMore}
                    className="label-mono"
                    style={{
                      fontSize: 11,
                      padding: "8px 14px",
                      background: "var(--cl-bg-02)",
                      border: "1px solid var(--cl-border-subtle)",
                      borderRadius: 6,
                      cursor: loadingMore ? "default" : "pointer",
                      color: "var(--cl-text-secondary)",
                    }}
                  >
                    {loadingMore ? "Loading…" : "Load more"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {isMobile && drawerOpen && (
        <>
          <div
            data-testid="sessions-drawer-backdrop"
            onClick={closeDrawer}
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
            data-testid="sessions-drawer"
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
            <SessionsFilterRail
              filters={filters}
              agents={agents ?? []}
              onSelect={handleSelect}
              onClear={handleClear}
              isMobile
            />
          </aside>
        </>
      )}
    </div>
  );
}
