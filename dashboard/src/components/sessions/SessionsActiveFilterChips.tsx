import {
  activeFilterCount,
  SESSION_FILTER_KEYS,
  type SessionFilters,
} from "../../lib/sessionFilters";

interface Props {
  filters: SessionFilters;
  onClear: (key: keyof SessionFilters) => void;
  onClearAll: () => void;
}

/**
 * Strip of removable chips above the feed showing every active filter.
 * Mirrors `dashboard/src/components/activity/ActiveFilterChips.tsx`.
 */
function labelFor(key: keyof SessionFilters, value: string): string {
  if (key === "risk") return value.toUpperCase();
  if (key === "since") return `last ${value}`;
  if (key === "duration") return value;
  if (key === "view") return value;
  return value;
}

export default function SessionsActiveFilterChips({ filters, onClear, onClearAll }: Props) {
  if (activeFilterCount(filters) === 0) return null;

  return (
    <div
      data-testid="active-filter-strip"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        flexWrap: "wrap",
        marginBottom: 18,
      }}
    >
      <span className="label-mono" style={{ fontSize: 10, color: "var(--cl-text-muted)" }}>
        FROM URL
      </span>
      {SESSION_FILTER_KEYS.map((key) => {
        const value = filters[key];
        if (!value) return null;
        return (
          <span
            key={key}
            data-testid={`active-chip-${key}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              height: 24,
              padding: "0 4px 0 9px",
              background: "var(--cl-accent-tint)",
              border: "1px solid var(--cl-accent-ring)",
              borderRadius: 4,
              fontSize: 11,
              fontFamily: "var(--cl-font-mono)",
              color: "var(--cl-text-primary)",
            }}
          >
            <span style={{ color: "var(--cl-text-secondary)" }}>{key}:</span>
            <span>{labelFor(key, value)}</span>
            <button
              type="button"
              data-testid={`active-chip-${key}-remove`}
              onClick={() => onClear(key)}
              style={{
                width: 16,
                height: 16,
                padding: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: "var(--cl-text-secondary)",
              }}
              aria-label={`remove ${key} filter`}
            >
              <svg
                width="9"
                height="9"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                aria-hidden="true"
              >
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </span>
        );
      })}
      <button
        type="button"
        data-testid="active-filter-clear-all"
        onClick={onClearAll}
        className="label-mono"
        style={{
          fontSize: 10,
          padding: "4px 6px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: "var(--cl-accent)",
        }}
      >
        CLEAR ALL
      </button>
    </div>
  );
}
