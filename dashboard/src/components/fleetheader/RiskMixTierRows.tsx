import { useNavigate } from "react-router-dom";

/**
 * stat-cards-revamp-spec §4.1 — Risk Mix card replaced with a list of
 * full-width tier rows. Each row IS the click target (whole row → button)
 * and routes to /activity?tier=<tier>. Component owns its own `cl-card`
 * surface; the donut shape is gone.
 */

interface Props {
  breakdown: { low: number; medium: number; high: number; critical: number };
  /** Optional explicit denominator for proportion math; defaults to sum. */
  total?: number;
}

type TierKey = "critical" | "high" | "medium" | "low";

/**
 * Lower bound on rendered bar width (% of track) when count > 0. Tiny minorities
 * (n=1, T=10000) would otherwise render as an invisible sliver — the spec
 * trades exact proportion for legibility because the magnitude is also shown
 * numerically in the count cell. Tunable in live walk per spec §8.1.
 */
export const MIN_FLOOR_PCT = 4;

// Severity-down — top to bottom: CRIT → HIGH → MED → LOW.
const TIER_ORDER: TierKey[] = ["critical", "high", "medium", "low"];

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

function formatRightCell(count: number, denominator: number): string {
  if (denominator <= 0) return String(count);
  if (count <= 0) return String(count);
  const rawPct = (count / denominator) * 100;
  if (count === denominator) return `${count} · 100%`;
  const rounded = Math.round(rawPct);
  if (rounded === 0) return `${count} · <1%`;
  return `${count} · ${rounded}%`;
}

function barWidthPct(count: number, denominator: number): number {
  if (count <= 0 || denominator <= 0) return 0;
  return Math.max(MIN_FLOOR_PCT, (count / denominator) * 100);
}

export default function RiskMixTierRows({ breakdown, total }: Props) {
  const navigate = useNavigate();
  const counts: Record<TierKey, number> = {
    critical: breakdown.critical,
    high: breakdown.high,
    medium: breakdown.medium,
    low: breakdown.low,
  };
  const sum = counts.critical + counts.high + counts.medium + counts.low;
  const denominator = total ?? sum;

  return (
    <div
      className="cl-card"
      data-cl-risk-mix-card
      style={{
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        minHeight: 132,
      }}
    >
      {/* Header strip ─ label-mono left, mono-numeric total right */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <span
          className="label-mono"
          style={{ letterSpacing: "0.04em", color: "var(--cl-text-muted)" }}
        >
          RISK MIX · 24H
        </span>
        <span
          data-cl-risk-mix-header-total
          className="label-mono"
          style={{
            letterSpacing: "0.04em",
            color: "var(--cl-text-muted)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {sum} actions
        </span>
      </div>

      {/* Tier rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {TIER_ORDER.map((tier) => {
          const count = counts[tier];
          const width = barWidthPct(count, denominator);
          return (
            <button
              key={tier}
              type="button"
              className="cl-risk-tier-row"
              data-cl-tier-row
              data-cl-tier={tier}
              onClick={() => navigate(`/activity?tier=${tier}`)}
              aria-label={`${count} ${TIER_LABELS[tier]} actions — filter activity`}
              style={{
                display: "grid",
                gridTemplateColumns: "44px 1fr auto",
                alignItems: "center",
                gap: 10,
                background: "transparent",
                border: "none",
                padding: "4px 6px",
                margin: "0 -6px",
                borderRadius: "var(--cl-r-xs)",
                cursor: "pointer",
                textAlign: "left",
                fontFamily: "var(--cl-font-sans)",
                color: "var(--cl-text-muted)",
              }}
            >
              <span
                data-cl-tier-label
                className="label-mono"
                style={{
                  color: TIER_COLORS[tier],
                  letterSpacing: "0.06em",
                }}
              >
                {TIER_LABELS[tier]}
              </span>
              <div
                data-cl-bar-track
                style={{
                  position: "relative",
                  width: "100%",
                  height: 6,
                  background: "var(--cl-bg-03)",
                  borderRadius: "var(--cl-r-xs)",
                  overflow: "hidden",
                }}
              >
                {width > 0 ? (
                  <div
                    data-cl-bar-fill
                    style={{
                      width: `${width}%`,
                      height: "100%",
                      background: TIER_COLORS[tier],
                      transition: "width var(--cl-dur-fast) var(--cl-ease)",
                    }}
                  />
                ) : null}
              </div>
              <span
                data-cl-count
                style={{
                  fontSize: 13,
                  fontWeight: 510,
                  color: "var(--cl-text-primary)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {formatRightCell(count, denominator)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
