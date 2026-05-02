interface VerbChipProps {
  verb: string;
  on: boolean;
  onClick?: () => void;
  disabled?: boolean;
  hint?: string;
}

/**
 * Toggle chip — uppercase mono label, accent-tinted on-state, dim disabled.
 * The leading dot is the visual on-marker so the active chip pops at a glance
 * even when the operator is scanning across a row.
 */
export default function VerbChip({ verb, on, onClick, disabled, hint }: VerbChipProps) {
  return (
    <button
      type="button"
      onClick={() => {
        if (!disabled) onClick?.();
      }}
      disabled={disabled}
      title={hint}
      className="inline-flex items-center gap-1 px-2 rounded-md transition-colors"
      style={{
        height: "22px",
        fontFamily: "var(--cl-font-mono)",
        fontSize: "11px",
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        backgroundColor: on ? "var(--cl-accent-tint)" : "transparent",
        border: `1px solid ${on ? "var(--cl-accent-ring)" : "var(--cl-border-subtle)"}`,
        color: disabled
          ? "var(--cl-text-muted)"
          : on
            ? "var(--cl-text-primary)"
            : "var(--cl-text-secondary)",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {on && (
        <span
          aria-hidden
          className="inline-block w-1 h-1 rounded-full"
          style={{ backgroundColor: "var(--cl-accent)" }}
        />
      )}
      {verb.toUpperCase()}
    </button>
  );
}
