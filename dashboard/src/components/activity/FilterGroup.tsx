import type React from "react";

interface Props {
  label: string;
  /** Stable id for tests + collapse-state keying. */
  groupKey: string;
  collapsed: boolean;
  onToggleCollapse: () => void;
  cleared: boolean;
  onClear: () => void;
  children: React.ReactNode;
  /**
   * Optional control rendered right of the chevron+label, before the CLEAR
   * link. Used by the saved-searches group for its `+` save button; existing
   * groups pass nothing and render unchanged.
   */
  headerAction?: React.ReactNode;
}

/**
 * Collapsible group container. Header has a chevron toggle, the group label,
 * and (when a filter is active in this group) a CLEAR link. Children are the
 * `FilterRow` options for the group; hidden when collapsed.
 */
export default function FilterGroup({
  label,
  groupKey,
  collapsed,
  onToggleCollapse,
  cleared,
  onClear,
  children,
  headerAction,
}: Props) {
  return (
    <div data-testid={`filter-group-${groupKey}`} style={{ marginBottom: 12 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          marginBottom: 4,
          padding: "0 4px",
          height: 18,
        }}
      >
        <button
          type="button"
          data-testid={`filter-group-header-${groupKey}`}
          onClick={onToggleCollapse}
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: 0,
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: "var(--cl-text-muted)",
            textAlign: "left",
          }}
        >
          <svg
            width="8"
            height="8"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            style={{
              transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
              transition: "transform 120ms var(--cl-ease)",
            }}
            aria-hidden="true"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
          <span className="label-mono" style={{ fontSize: 10 }}>
            {label}
          </span>
        </button>
        {headerAction}
        {cleared && (
          <button
            type="button"
            data-testid={`filter-clear-${groupKey}`}
            onClick={onClear}
            className="label-mono"
            style={{
              fontSize: 9,
              background: "transparent",
              border: "none",
              color: "var(--cl-accent)",
              cursor: "pointer",
              padding: 0,
              marginLeft: 4,
            }}
          >
            CLEAR
          </button>
        )}
      </div>
      {!collapsed && <div>{children}</div>}
    </div>
  );
}
