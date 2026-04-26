import { riskColorRaw } from "../../lib/utils";
import type { EntryResponse, RiskTier } from "../../lib/types";

interface Props {
  /** Entries the bar paints — typically the currently filtered displayed feed. */
  entries: EntryResponse[];
}

const TIER_ORDER: RiskTier[] = ["critical", "high", "medium", "low"];

/**
 * 110×4 stacked bar showing the tier breakdown of the entries it's given.
 * Hover surfaces per-tier counts via the title attribute (a richer popover
 * is Phase 2.5 territory). Returns null when `entries` is empty so the
 * header doesn't carry a stub bar with no information.
 */
export default function HeaderMixBar({ entries }: Props) {
  const mix: Record<RiskTier, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const e of entries) {
    if (e.riskTier === "low" || e.riskTier === "medium" || e.riskTier === "high" || e.riskTier === "critical") {
      mix[e.riskTier]++;
    }
  }
  const total = mix.low + mix.medium + mix.high + mix.critical;
  if (total === 0) return null;

  const title = TIER_ORDER.filter((t) => mix[t] > 0)
    .map((t) => `${t}: ${mix[t]}`)
    .join("  ·  ");

  return (
    <div
      data-testid="header-mix-bar"
      title={title}
      style={{
        width: 110,
        height: 4,
        display: "flex",
        borderRadius: 2,
        overflow: "hidden",
        background: "var(--cl-bg-04)",
      }}
    >
      {TIER_ORDER.map((t) =>
        mix[t] > 0 ? (
          <div
            key={t}
            data-cl-tier={t}
            style={{ flex: mix[t], background: riskColorRaw(t) }}
          />
        ) : null,
      )}
    </div>
  );
}
