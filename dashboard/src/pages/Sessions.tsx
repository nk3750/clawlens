import { useCallback, useEffect, useMemo } from "react";
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
              alignItems: "baseline",
              justifyContent: "space-between",
              marginBottom: 14,
            }}
          >
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
    </div>
  );
}
