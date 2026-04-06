interface Props {
  message?: string;
  onRetry?: () => void;
}

export default function ErrorCard({ message, onRetry }: Props) {
  return (
    <div className="error-card max-w-md mx-auto my-16">
      {/* Warning icon */}
      <svg
        width="32"
        height="32"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--cl-text-muted)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mx-auto mb-4"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>

      <p
        className="font-display font-semibold mb-2"
        style={{ color: "var(--cl-text-primary)", fontSize: "var(--text-subhead)" }}
      >
        Unable to connect to ClawLens
      </p>

      {message && (
        <p className="text-sm mb-4" style={{ color: "var(--cl-text-muted)" }}>
          {message}
        </p>
      )}

      {onRetry && (
        <button
          onClick={onRetry}
          className="btn-press label-mono px-4 py-2 rounded-lg border transition-colors"
          style={{
            color: "var(--cl-accent)",
            borderColor: "var(--cl-border-default)",
            backgroundColor: "transparent",
          }}
        >
          RETRY
        </button>
      )}
    </div>
  );
}
