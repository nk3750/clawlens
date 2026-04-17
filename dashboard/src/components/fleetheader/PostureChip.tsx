import type { RiskPosture } from "../../lib/types";
import { postureDotColor, postureLabel, postureTooltip } from "./utils";

interface Props {
  posture: RiskPosture;
}

/**
 * Single-glance fleet verdict: dot + posture label. Click scrolls to the
 * attention inbox (or the fleet chart when the inbox is empty / hidden).
 */
export default function PostureChip({ posture }: Props) {
  const color = postureDotColor(posture);
  const label = postureLabel(posture);
  const tip = postureTooltip(posture);

  function onClick() {
    const target =
      document.querySelector<HTMLElement>("[data-cl-attention-anchor]") ??
      document.querySelector<HTMLElement>("[data-cl-fleet-chart-anchor]");
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title={tip}
      aria-label={`Posture ${label.toLowerCase()}: ${tip}`}
      className="cl-fh-chip btn-press inline-flex items-center"
      style={{
        gap: 6,
        padding: "4px 10px",
        borderRadius: "var(--cl-radius-sm, 6px)",
        border: "1px solid var(--cl-border-subtle)",
        background: `color-mix(in srgb, ${color} 8%, transparent)`,
        color: "var(--cl-text-primary)",
        cursor: "pointer",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: color,
          boxShadow: `0 0 6px ${color}`,
        }}
      />
      <span
        className="font-mono"
        style={{
          color,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.06em",
        }}
      >
        {label}
      </span>
    </button>
  );
}
