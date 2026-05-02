import type { Target } from "../../lib/types";

interface UpgradeBannerProps {
  /** Always "identity-glob" in Phase 2.5 — the kind every Activity-row create starts at. */
  from: Target["kind"];
  to: Target["kind"];
  reason: string;
}

/**
 * Accent-tinted callout shown in the create-rule modal when the operator's
 * verb / pattern choices flip the rule's target kind from identity-glob to
 * a resource-pattern kind (path-glob / command-glob / url-glob).
 */
export default function UpgradeBanner({ from, to, reason }: UpgradeBannerProps) {
  return (
    <div
      data-testid="upgrade-banner"
      className="flex items-start gap-2"
      style={{
        padding: "8px 10px",
        borderRadius: "var(--cl-r-md)",
        backgroundColor: "var(--cl-accent-tint)",
        border: "1px solid var(--cl-accent-ring)",
        fontSize: "12px",
        lineHeight: 1.5,
      }}
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--cl-accent)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className="shrink-0 mt-0.5"
      >
        <title>Target upgrade</title>
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
      <div>
        <span style={{ color: "var(--cl-text-primary)" }}>{reason}</span>{" "}
        <span style={{ color: "var(--cl-text-secondary)" }}>
          Target upgraded from{" "}
          <code style={{ fontFamily: "var(--cl-font-mono)" }}>{from}</code> →{" "}
          <code style={{ fontFamily: "var(--cl-font-mono)" }}>{to}</code>.
        </span>
      </div>
    </div>
  );
}
