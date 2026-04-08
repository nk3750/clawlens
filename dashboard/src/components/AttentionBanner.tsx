interface Props {
  reason: string;
  onDismiss: () => void;
}

export default function AttentionBanner({ reason, onDismiss }: Props) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-3 rounded-xl mb-6"
      style={{
        boxShadow: "inset 3px 0 0 0 var(--cl-risk-high)",
        backgroundColor: "rgba(248,113,113,0.05)",
      }}
    >
      {/* Warning triangle */}
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--cl-risk-high)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0"
      >
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>

      <span className="text-sm flex-1" style={{ color: "var(--cl-text-primary)" }}>
        Needs attention: {reason}
      </span>

      <button
        onClick={onDismiss}
        className="shrink-0 p-1 rounded transition-colors"
        style={{ color: "var(--cl-text-muted)" }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}
