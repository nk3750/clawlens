interface Props {
  count: number;
}

/**
 * Pending approvals chip — accent-colored. Hidden by Agents.tsx when count is
 * zero. Source is currently derived from /api/interventions filtered by
 * effectiveDecision === "pending"; the attention-inbox spec will replace it.
 */
export default function PendingChip({ count }: Props) {
  function onClick() {
    const target =
      document.querySelector<HTMLElement>("[data-cl-inbox-pending-anchor]") ??
      document.querySelector<HTMLElement>("[data-cl-attention-anchor]");
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title={`${count} pending approval${count === 1 ? "" : "s"} — review the inbox`}
      aria-label={`${count} pending approvals`}
      className="cl-fh-chip btn-press inline-flex items-center"
      style={{
        gap: 6,
        padding: "4px 10px",
        borderRadius: "var(--cl-radius-sm, 6px)",
        border: "1px solid color-mix(in srgb, var(--cl-accent) 30%, transparent)",
        background: "var(--cl-accent-7)",
        cursor: "pointer",
        color: "var(--cl-accent)",
      }}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--cl-accent)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
      <span
        className="font-mono"
        style={{ fontSize: 11, fontWeight: 700, color: "var(--cl-accent)" }}
      >
        {count}
      </span>
      <span className="font-sans" style={{ fontSize: 11, color: "var(--cl-text-secondary)" }}>
        pending
      </span>
    </button>
  );
}
