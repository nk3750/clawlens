import type { RiskTier } from "../lib/types";

interface Props {
  mix: Record<RiskTier, number>;
  /**
   * Canonical action-count denominator. Pass when `total` can diverge from
   * `sum(mix)` — e.g. when some entries lack a risk score, we still want the
   * bar's arc-length scaled against the footer's action count so the two
   * numbers stay visually consistent.
   */
  total?: number;
}

// Severity-ordered draw: low first anchors the left (where most agents live),
// crit ends on the right so a 1-2% crit slice catches the eye against the
// low-tier mass rather than getting buried between medium and high.
const DRAW_ORDER: RiskTier[] = ["low", "medium", "high", "critical"];

const TIER_COLORS: Record<RiskTier, string> = {
  low: "var(--cl-risk-low)",
  medium: "var(--cl-risk-medium)",
  high: "var(--cl-risk-high)",
  critical: "var(--cl-risk-critical)",
};

const TIER_LABELS: Record<RiskTier, string> = {
  low: "low",
  medium: "med",
  high: "high",
  critical: "crit",
};

export default function RiskMixMicrobar({ mix, total }: Props) {
  const sum = mix.low + mix.medium + mix.high + mix.critical;
  const denominator = total ?? sum;
  // Nothing to show AND no promise of a stable layout slot → render nothing.
  // When `total` is provided we keep the track visible so the card layout
  // doesn't shift when scored entries arrive mid-render.
  if (denominator <= 0) return null;

  const summary = DRAW_ORDER.filter((t) => mix[t] > 0)
    .map((t) => `${TIER_LABELS[t]} ${mix[t]}`)
    .join(" · ");

  return (
    <div
      data-cl-risk-mix-microbar
      role="img"
      aria-label={`risk mix today: ${summary}`}
      title={`risk today — ${summary}`}
      style={{
        display: "flex",
        width: "100%",
        height: 4,
        borderRadius: 2,
        overflow: "hidden",
        backgroundColor: "color-mix(in srgb, var(--cl-text-muted) 12%, transparent)",
      }}
    >
      {DRAW_ORDER.map((tier) => {
        const count = mix[tier];
        if (count <= 0) return null;
        const pct = (count / denominator) * 100;
        return (
          <div
            key={tier}
            data-cl-risk-mix-seg={tier}
            style={{
              width: `${pct}%`,
              backgroundColor: TIER_COLORS[tier],
            }}
          />
        );
      })}
    </div>
  );
}
