import { useCallback, useMemo, useState } from "react";
import type { Filters } from "../../lib/activityFilters";
import type { EntryResponse } from "../../lib/types";
import ActiveFilterChips from "./ActiveFilterChips";
import ActivityRow from "./ActivityRow";
import HeaderMixBar from "./HeaderMixBar";
import SearchInput from "./SearchInput";

interface Props {
  filters: Filters;
  /** Entries currently displayed (already API-filtered). */
  entries: EntryResponse[];
  /** Broader population for the "X of Y actions" denominator (24h count basis). */
  totalCount: number;
  /**
   * True when `totalCount` is at the count-basis fetch cap — the gateway
   * may have more entries in the 24h window than were sampled. Renders Y
   * as a floor (`200+`) instead of a ceiling (`200`). Required (no
   * default) so a future refactor can't silently drop the floor signal.
   */
  totalCountAtCap: boolean;
  /** Set of toolCallId/timestamp keys that arrived via SSE within the last ~1.8s. */
  newIds: Set<string>;
  paused: boolean;
  /** True while another page is available (last fetched page filled the window). */
  hasMore: boolean;
  /** True while a Load-more fetch is in flight. */
  loadingMore: boolean;
  onTogglePause: () => void;
  onClear: (key: keyof Filters) => void;
  onClearAll: () => void;
  /** Inline filter chip clicks from rows. */
  onChip: (key: "agent" | "tier", value: string) => void;
  onLoadMore: () => void;
  /** Phase 2.7 (#35) — debounced free-text search → URL state. */
  onSetQ: (q: string) => void;
  /**
   * Phase 2.9 (#37) — drawer mode (≤1023px). When true, the feed shows
   * the hamburger button (drives onToggleDrawer) and hides the header
   * mini-bar. Activity.tsx hosts the drawer overlay state itself.
   */
  isMobile: boolean;
  /** Phase 2.9 (#37) — compact viewport (<768px). */
  isCompact: boolean;
  /** Phase 2.9 (#37) — narrow viewport (<640px). */
  isNarrow: boolean;
  /**
   * Phase 2.9 (#37) — toggle the rail-drawer open/closed. Required when
   * isMobile is true; ignored otherwise.
   */
  onToggleDrawer?: () => void;
}

interface HourGroup {
  label: string;
  rows: EntryResponse[];
}

/** Bucket entries by local hour-of-day (e.g. `17:00`). Most recent hour first. */
function groupByHour(entries: EntryResponse[]): HourGroup[] {
  const map = new Map<string, EntryResponse[]>();
  for (const e of entries) {
    const d = new Date(e.timestamp);
    const label = `${d.getHours().toString().padStart(2, "0")}:00`;
    const arr = map.get(label);
    if (arr) arr.push(e);
    else map.set(label, [e]);
  }
  return [...map.entries()].map(([label, rows]) => ({ label, rows }));
}

export default function ActivityFeed({
  filters,
  entries,
  totalCount,
  totalCountAtCap,
  newIds,
  paused,
  hasMore,
  loadingMore,
  onTogglePause,
  onClear,
  onClearAll,
  onChip,
  onLoadMore,
  onSetQ,
  isMobile,
  isCompact,
  isNarrow,
  onToggleDrawer,
}: Props) {
  const grouped = useMemo(() => groupByHour(entries), [entries]);

  // Single expanded row across the entire feed — clicking a different row
  // collapses the previous one. Phase 2.2.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const toggleExpanded = useCallback(
    (id: string) => setExpandedId((prev) => (prev === id ? null : id)),
    [],
  );

  // Phase 2.9 (#37) — single-tap row state (analogous to expandedId). Compact
  // viewport tap-to-reveal swaps tappedId so the strip is single-at-a-time.
  const [tappedId, setTappedId] = useState<string | null>(null);
  const toggleTapped = useCallback(
    (id: string) => setTappedId((prev) => (prev === id ? null : id)),
    [],
  );

  return (
    <div style={{ padding: "24px 32px", minWidth: 0 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
        {isMobile && (
          <button
            type="button"
            data-testid="activity-drawer-toggle"
            aria-label="Open filter drawer"
            onClick={onToggleDrawer}
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
            margin: 0,
            fontWeight: 510,
            fontSize: isNarrow ? 24 : 30,
            letterSpacing: "-0.7px",
            color: "var(--cl-text-primary)",
          }}
        >
          Activity
        </h1>
        <button
          type="button"
          data-testid="live-pause-toggle"
          onClick={onTogglePause}
          title={paused ? "resume live" : "pause live"}
          aria-label={paused ? "resume live updates" : "pause live updates"}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            height: 22,
            padding: "0 8px",
            background: "transparent",
            border: "none",
            cursor: "pointer",
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              background: paused ? "var(--cl-text-muted)" : "var(--cl-risk-low)",
              boxShadow: paused
                ? "none"
                : "0 0 0 3px color-mix(in srgb, var(--cl-risk-low) 22%, transparent)",
              animation: paused ? "none" : "cl-pulse 2s infinite",
            }}
          />
          {!isCompact && (
            <span
              className="label-mono"
              style={{
                fontSize: 10,
                color: paused ? "var(--cl-text-muted)" : "var(--cl-text-secondary)",
              }}
            >
              {paused ? "PAUSED" : "LIVE"}
            </span>
          )}
        </button>
        <span style={{ flex: 1 }} />
        {!isMobile && <HeaderMixBar entries={entries} />}
        <span
          className="mono"
          data-testid="feed-count"
          style={{ fontSize: 12, color: "var(--cl-text-secondary)", fontFeatureSettings: '"tnum"' }}
        >
          <span style={{ color: "var(--cl-text-primary)" }}>{entries.length}</span>
          <span style={{ color: "var(--cl-text-muted)" }}>
            {` of ${totalCount}${totalCountAtCap ? "+" : ""} actions`}
          </span>
        </span>
      </div>

      {/* Free-text search (Phase 2.7, #35) */}
      <SearchInput value={filters.q ?? ""} onChange={onSetQ} />

      {/* Active filter chip strip */}
      <ActiveFilterChips filters={filters} onClear={onClear} onClearAll={onClearAll} />

      {/* Empty state */}
      {entries.length === 0 && (
        <div
          data-testid="feed-empty"
          style={{
            padding: "60px 20px",
            textAlign: "center",
            border: "1px dashed var(--cl-border-subtle)",
            borderRadius: 8,
          }}
        >
          <div style={{ fontSize: 14, color: "var(--cl-text-secondary)" }}>
            no actions match these filters
          </div>
          <button
            type="button"
            onClick={onClearAll}
            className="cl-btn cl-btn-subtle"
            style={{ marginTop: 12 }}
          >
            clear filters
          </button>
        </div>
      )}

      {/* Hour-grouped feed */}
      {grouped.map((group) => (
        <div key={group.label} style={{ marginBottom: 22 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 6,
              paddingLeft: 4,
            }}
          >
            <span
              className="label-mono"
              style={{ fontSize: 10, color: "var(--cl-text-muted)", fontFeatureSettings: '"tnum"' }}
            >
              {group.label}
            </span>
            <span style={{ flex: 1, height: 1, background: "var(--cl-border-subtle)" }} />
            <span
              className="mono"
              style={{ fontSize: 10, color: "var(--cl-text-muted)" }}
            >
              {group.rows.length}
            </span>
          </div>
          <div
            style={{
              borderRadius: 8,
              overflow: "hidden",
              border: "1px solid var(--cl-border-subtle)",
            }}
          >
            {group.rows.map((entry, i) => {
              const id = entry.toolCallId || entry.timestamp;
              return (
                <ActivityRow
                  key={`${id}-${i}`}
                  entry={entry}
                  isNew={newIds.has(id)}
                  onChip={onChip}
                  isLastInGroup={i === group.rows.length - 1}
                  isExpanded={expandedId === id}
                  onToggleExpand={() => toggleExpanded(id)}
                  isCompact={isCompact}
                  isNarrow={isNarrow}
                  isTapped={tappedId === id}
                  onToggleTapped={() => toggleTapped(id)}
                />
              );
            })}
          </div>
        </div>
      ))}

      {/* Load more — paginates the displayed feed. Hidden once the API
          returns a partial page (<DISPLAYED_LIMIT) or while the feed is empty. */}
      {entries.length > 0 && hasMore && (
        <button
          type="button"
          data-testid="load-more-btn"
          onClick={onLoadMore}
          disabled={loadingMore}
          style={{
            width: "100%",
            marginTop: 16,
            padding: "12px",
            fontSize: 13,
            fontFamily: "var(--cl-font-sans)",
            color: "var(--cl-text-muted)",
            background: "transparent",
            border: "1px solid var(--cl-border-subtle)",
            borderRadius: 12,
            cursor: loadingMore ? "default" : "pointer",
            opacity: loadingMore ? 0.5 : 1,
            transition: "background var(--cl-dur-fast) var(--cl-ease)",
          }}
        >
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      )}

      <style>{`
        @keyframes row-flash {
          0%   { background: color-mix(in srgb, var(--cl-accent) 18%, transparent); }
          100% { background: var(--cl-bg-02); }
        }
        @keyframes row-slide {
          0% { transform: translateY(-6px); opacity: 0; }
          100% { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
