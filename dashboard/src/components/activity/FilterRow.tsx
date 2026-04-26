import type React from "react";

interface Props {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
  /** Identifier for tests; also used as a stable key to scope clicks. */
  testId?: string;
}

/**
 * One option row in a FilterGroup. Renders as a button so keyboard users get
 * focus + activation; clicks fire even on the active option (the parent
 * decides toggle vs. clear based on prior state).
 *
 * Disabled state visualizes "this filter would yield 0 rows under the other
 * active filters". The active-but-zero case stays enabled so the user can
 * always click to clear what they selected.
 */
export default function FilterRow({ active, disabled, onClick, children, testId }: Props) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: "5px 7px",
        marginBottom: 1,
        background: active ? "var(--cl-bg-04)" : "transparent",
        color: active
          ? "var(--cl-text-primary)"
          : disabled
            ? "var(--cl-text-muted)"
            : "var(--cl-text-secondary)",
        border: "none",
        borderRadius: 4,
        fontSize: 12,
        fontFamily: "var(--cl-font-sans)",
        cursor: disabled ? "default" : "pointer",
        textAlign: "left",
        opacity: disabled ? 0.55 : 1,
      }}
    >
      {children}
    </button>
  );
}
