import { useEffect, useState } from "react";

interface Props {
  /** Current `q` filter value from URL state. Empty string = no filter. */
  value: string;
  /** Push the (debounced) input value to URL state. Empty string clears `q`. */
  onChange: (next: string) => void;
}

const DEBOUNCE_MS = 200;
const MAX_LENGTH = 200;

/**
 * Phase 2.7 (#35) — debounced free-text search above the active-filter strip.
 * Owns its own `text` state for the controlled input; pushes to URL only after
 * 200ms of inactivity. Resets internal state when the `value` prop changes
 * externally (e.g., chip × removes `q`, saved-search applies `q`).
 *
 * The 200-char cap is enforced on the `<input>` element via `maxLength`; the
 * server-side 400 stays as defense-in-depth for direct URL manipulation.
 */
export default function SearchInput({ value, onChange }: Props) {
  const [text, setText] = useState(value);

  // Re-sync internal state whenever the URL-driven `value` changes from the
  // outside (chip ×, saved search, programmatic clear). Skipping this leaves
  // the input visually out of sync with the active filter.
  useEffect(() => {
    setText(value);
  }, [value]);

  // Debounced push to URL. Cancel the pending push on every keystroke so a
  // burst of keys settles into a single URL update once typing stops.
  useEffect(() => {
    if (text === value) return;
    const id = setTimeout(() => onChange(text), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [text, value, onChange]);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        height: 32,
        marginBottom: 12,
        padding: "0 10px",
        background: "var(--cl-bg-02)",
        border: "1px solid var(--cl-border-subtle)",
        borderRadius: 6,
      }}
    >
      <svg
        data-testid="activity-search-icon"
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
        style={{ color: "var(--cl-text-muted)", flexShrink: 0 }}
      >
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.3-4.3" />
      </svg>
      <input
        data-testid="activity-search-input"
        type="text"
        placeholder="search entries"
        value={text}
        maxLength={MAX_LENGTH}
        onChange={(e) => setText(e.target.value)}
        style={{
          flex: 1,
          minWidth: 0,
          height: "100%",
          padding: 0,
          background: "transparent",
          border: "none",
          outline: "none",
          fontFamily: "var(--cl-font-mono)",
          fontSize: 12,
          color: "var(--cl-text-primary)",
        }}
      />
      {text && (
        <button
          type="button"
          data-testid="activity-search-clear"
          onClick={() => {
            setText("");
            onChange("");
          }}
          aria-label="clear search"
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
            flexShrink: 0,
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
      )}
    </div>
  );
}
