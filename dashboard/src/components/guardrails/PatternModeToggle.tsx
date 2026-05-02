interface PatternModeToggleProps {
  mode: "exact" | "glob";
  onChange: (mode: "exact" | "glob") => void;
  disabled?: boolean;
}

/**
 * Segmented two-state toggle: "Exactly this" vs "Broader pattern".
 * Disabled state covers MCP / unknown-tool entries (`resourceKind === "advanced"`)
 * — those rules can't broaden, so the toggle becomes a read-only marker.
 */
export default function PatternModeToggle({ mode, onChange, disabled }: PatternModeToggleProps) {
  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: "1fr 1fr",
        padding: "3px",
        backgroundColor: "var(--cl-bg-02)",
        border: "1px solid var(--cl-border)",
        borderRadius: "var(--cl-r-md)",
        opacity: disabled ? 0.7 : 1,
      }}
    >
      <ModeButton
        testId="pattern-mode-exact"
        title="Exactly this"
        sub="identity match"
        active={mode === "exact"}
        disabled={disabled}
        onClick={() => onChange("exact")}
      />
      <ModeButton
        testId="pattern-mode-glob"
        title="Broader pattern"
        sub="glob match"
        active={mode === "glob"}
        disabled={disabled}
        onClick={() => onChange("glob")}
      />
    </div>
  );
}

function ModeButton({
  testId,
  title,
  sub,
  active,
  disabled,
  onClick,
}: {
  testId: string;
  title: string;
  sub: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      data-active={active ? "true" : "false"}
      disabled={disabled}
      onClick={() => {
        if (!disabled) onClick();
      }}
      className="flex flex-col items-start px-3 py-1.5 rounded-md transition-colors"
      style={{
        backgroundColor: active ? "var(--cl-bg-05)" : "transparent",
        color: active ? "var(--cl-text-primary)" : "var(--cl-text-muted)",
        cursor: disabled ? "default" : "pointer",
        transition: "background var(--cl-dur-fast) var(--cl-ease)",
        border: "none",
      }}
    >
      <span className="text-sm" style={{ color: "inherit" }}>
        {title}
      </span>
      <span
        className="text-[10px]"
        style={{
          fontFamily: "var(--cl-font-mono)",
          letterSpacing: "0.06em",
          color: "var(--cl-text-muted)",
        }}
      >
        {sub}
      </span>
    </button>
  );
}
