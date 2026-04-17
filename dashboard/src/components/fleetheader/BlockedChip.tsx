import { riskColorRaw } from "../../lib/utils";

interface Props {
  count: number;
}

/**
 * Conditional chip — Agents.tsx hides this when count is zero, so we render
 * unconditionally here. Click scrolls to the inbox T2a section if present.
 */
export default function BlockedChip({ count }: Props) {
  const color = riskColorRaw("high");

  function onClick() {
    const target =
      document.querySelector<HTMLElement>("[data-cl-inbox-blocked-anchor]") ??
      document.querySelector<HTMLElement>("[data-cl-attention-anchor]");
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title={`${count} blocked action${count === 1 ? "" : "s"} — review the inbox`}
      aria-label={`${count} blocked actions`}
      className="cl-fh-chip btn-press inline-flex items-center"
      style={{
        gap: 6,
        padding: "4px 10px",
        borderRadius: "var(--cl-radius-sm, 6px)",
        border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
        background: `color-mix(in srgb, ${color} 8%, transparent)`,
        cursor: "pointer",
        color,
      }}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="15" y1="9" x2="9" y2="15" />
        <line x1="9" y1="9" x2="15" y2="15" />
      </svg>
      <span className="font-mono" style={{ fontSize: 11, fontWeight: 700, color }}>
        {count}
      </span>
      <span className="font-sans" style={{ fontSize: 11, color: "var(--cl-text-secondary)" }}>
        blocked
      </span>
    </button>
  );
}
