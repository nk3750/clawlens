import { useNavigate } from "react-router-dom";

interface Props {
  crit: number;
  high: number;
  medium: number;
  low: number;
  /**
   * Explicit denominator. Defaults to the sum of all four counts. Pass when
   * the caller scopes the donut to a range whose total is known but larger
   * than the visible counts — keeps arc lengths accurate under filtering.
   */
  total?: number;
}

type TierKey = "critical" | "high" | "medium" | "low";

const RADIUS = 40;
const CIRC = 2 * Math.PI * RADIUS;
const GAP_DEG = 2;
const GAP_LEN = (GAP_DEG / 360) * CIRC;

// Draw order around the ring (CW from 12 o'clock): low → med → high → crit.
// Matches the spec's CCW-reading-order — when a viewer reads the legend
// top-down (crit → low), the ring layout follows the count hierarchy.
const DRAW_ORDER: TierKey[] = ["low", "medium", "high", "critical"];

// Legend order top-down: crit above low (severity-first reading).
const LEGEND_ORDER: TierKey[] = ["critical", "high", "medium", "low"];

const TIER_LABELS: Record<TierKey, string> = {
  critical: "CRIT",
  high: "HIGH",
  medium: "MED",
  low: "LOW",
};

const TIER_COLORS: Record<TierKey, string> = {
  critical: "var(--cl-risk-critical)",
  high: "var(--cl-risk-high)",
  medium: "var(--cl-risk-medium)",
  low: "var(--cl-risk-low)",
};

export default function RiskMixDonut({ crit, high, medium, low, total }: Props) {
  const navigate = useNavigate();
  const counts: Record<TierKey, number> = { critical: crit, high, medium, low };
  const sum = crit + high + medium + low;
  const denominator = total ?? sum;
  const isEmpty = denominator <= 0;

  let cumulativeFrac = 0;
  const arcs: Array<{ tier: TierKey; segLen: number; dashOffset: number }> = [];
  if (!isEmpty) {
    for (const tier of DRAW_ORDER) {
      const count = counts[tier];
      if (count <= 0) continue;
      const frac = count / denominator;
      const segLen = Math.max(0, frac * CIRC - GAP_LEN);
      arcs.push({
        tier,
        segLen,
        dashOffset: -cumulativeFrac * CIRC,
      });
      cumulativeFrac += frac;
    }
  }

  const onTierClick = (tier: TierKey) => {
    navigate(`/activity?tier=${tier}`);
  };

  return (
    <div
      data-cl-risk-mix-donut-wrapper
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
      }}
    >
      <svg
        data-cl-risk-mix-donut
        width={64}
        height={64}
        viewBox="0 0 100 100"
        role="img"
        aria-label={isEmpty ? "Risk mix — no activity" : `Risk mix — ${sum} actions`}
        style={{ flexShrink: 0 }}
      >
        {/* Outline ring — always present; visible only in the empty state. */}
        <circle
          data-cl-outline
          cx={50}
          cy={50}
          r={RADIUS}
          fill="none"
          stroke="var(--cl-border)"
          strokeWidth={isEmpty ? 1 : 12}
          opacity={isEmpty ? 1 : 0}
        />
        {arcs.map(({ tier, segLen, dashOffset }) => (
          <circle
            key={tier}
            data-cl-arc
            data-cl-tier={tier}
            cx={50}
            cy={50}
            r={RADIUS}
            fill="none"
            stroke={TIER_COLORS[tier]}
            strokeWidth={12}
            strokeLinecap="butt"
            strokeDasharray={`${segLen} ${CIRC - segLen}`}
            strokeDashoffset={dashOffset}
            transform="rotate(-90 50 50)"
          />
        ))}
      </svg>

      <div
        data-cl-risk-mix-legend
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 2,
          minWidth: 110,
        }}
      >
        {LEGEND_ORDER.map((tier) => (
          <button
            key={tier}
            type="button"
            data-cl-risk-mix-legend-row
            data-cl-tier={tier}
            onClick={() => onTierClick(tier)}
            style={{
              display: "grid",
              gridTemplateColumns: "10px 1fr auto",
              alignItems: "center",
              gap: 8,
              background: "transparent",
              border: "none",
              padding: "2px 0",
              cursor: "pointer",
              textAlign: "left",
              fontFamily: "var(--cl-font-sans)",
              color: "var(--cl-text-muted)",
            }}
          >
            <span
              data-cl-legend-dot
              aria-hidden="true"
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                backgroundColor: TIER_COLORS[tier],
                justifySelf: "center",
              }}
            />
            <span
              data-cl-legend-label
              className="label-mono"
              style={{ letterSpacing: "0.06em" }}
            >
              {TIER_LABELS[tier]}
            </span>
            <span
              data-cl-count
              style={{
                fontSize: 14,
                fontWeight: 510,
                color: "var(--cl-text-primary)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {counts[tier]}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
