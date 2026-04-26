import { useEffect, useRef, useState } from "react";
import { useSavedSearches } from "../../hooks/useSavedSearches";
import { activeFilterCount, countWith, type Filters } from "../../lib/activityFilters";
import type { EntryResponse } from "../../lib/types";
import FilterGroup from "./FilterGroup";
import FilterRow from "./FilterRow";

interface Props {
  filters: Filters;
  /** Same count basis the rail uses for option counts (24h window, capped). */
  countBasis: EntryResponse[];
  /**
   * Replace the entire filter set when the operator clicks a saved row.
   * Distinct from the rail's `onSelect`/`onClear` (which mutate one key);
   * applying a saved search is a wholesale write.
   */
  onApplyFilters: (next: Filters) => void;
}

/**
 * Top-of-rail group that lets the operator name and recall filter combos.
 * Phase 2.8 (#36) sources from the backend store via useSavedSearches; the
 * hook handles the one-shot localStorage→backend migration on first mount.
 */
export default function SavedSearchesGroup({
  filters,
  countBasis,
  onApplyFilters,
}: Props) {
  const { items, add, remove } = useSavedSearches();
  const [collapsed, setCollapsed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the inline input on the next paint after entering add mode so the
  // operator can type without a separate click.
  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  const canSave = activeFilterCount(filters) > 0;

  const startAdd = () => {
    if (!canSave) return;
    setNameInput("");
    setAdding(true);
  };
  const cancelAdd = () => {
    setAdding(false);
    setNameInput("");
  };
  const commitAdd = async () => {
    const name = nameInput.trim();
    if (!name) {
      cancelAdd();
      return;
    }
    // The hook re-fetches internally on success; on failure (4xx/5xx/network)
    // it returns null and surfaces the error via console.warn — no toast for
    // this phase per the orchestrator spec.
    setAdding(false);
    setNameInput("");
    await add(name, filters);
  };

  const handleRemove = async (id: string, e: React.MouseEvent) => {
    // Stop propagation so the underlying FilterRow click doesn't also fire
    // onApplyFilters with the about-to-be-removed entry.
    e.stopPropagation();
    await remove(id);
  };

  const addBtn = (
    <button
      type="button"
      data-testid="saved-add-btn"
      title={canSave ? "Save current filters" : "Apply a filter to save"}
      onClick={startAdd}
      disabled={!canSave}
      aria-label="save current filters"
      style={{
        width: 16,
        height: 16,
        padding: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: "transparent",
        border: "none",
        cursor: canSave ? "pointer" : "default",
        color: canSave ? "var(--cl-accent)" : "var(--cl-text-muted)",
        opacity: canSave ? 1 : 0.45,
        marginLeft: 4,
      }}
    >
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        aria-hidden="true"
      >
        <path d="M12 5v14M5 12h14" />
      </svg>
    </button>
  );

  return (
    <FilterGroup
      groupKey="saved"
      label="saved"
      collapsed={collapsed}
      onToggleCollapse={() => setCollapsed((c) => !c)}
      cleared={false}
      onClear={() => {}}
      headerAction={addBtn}
    >
      {adding && (
        <div style={{ padding: "2px 7px 6px" }}>
          <input
            ref={inputRef}
            type="text"
            data-testid="saved-name-input"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitAdd();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancelAdd();
              }
            }}
            onBlur={cancelAdd}
            placeholder="name this view"
            style={{
              width: "100%",
              height: 26,
              padding: "0 8px",
              background: "var(--cl-bg-02)",
              border: "1px solid var(--cl-border-subtle)",
              borderRadius: 5,
              color: "var(--cl-text-primary)",
              fontSize: 12,
              fontFamily: "var(--cl-font-sans)",
              outline: "none",
            }}
          />
        </div>
      )}
      {items.map((s) => {
        const count = countWith(countBasis, s.filters);
        return (
          <div key={s.id} style={{ position: "relative" }}>
            <FilterRow
              active={false}
              disabled={false}
              onClick={() => onApplyFilters(s.filters)}
              testId={`saved-row-${s.id}`}
            >
              <span
                data-testid="saved-dot"
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 999,
                  background: "var(--cl-risk-low)",
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  flex: 1,
                  minWidth: 0,
                }}
              >
                {s.name}
              </span>
              <span
                className="mono"
                style={{
                  fontSize: 10,
                  color: "var(--cl-text-muted)",
                  // Reserve space so count doesn't sit under the × button.
                  marginRight: 18,
                }}
              >
                {count}
              </span>
            </FilterRow>
            <button
              type="button"
              data-testid={`saved-row-${s.id}-remove`}
              // mousedown stop too — onMouseDown fires before button click and
              // before the input's blur, preventing the input from being torn
              // down on its way to handling the × click.
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => handleRemove(s.id, e)}
              aria-label={`remove saved search ${s.name}`}
              title="remove"
              style={{
                position: "absolute",
                right: 4,
                top: "50%",
                transform: "translateY(-50%)",
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
                zIndex: 1,
              }}
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
          </div>
        );
      })}
    </FilterGroup>
  );
}
