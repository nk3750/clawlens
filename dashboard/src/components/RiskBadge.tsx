import type { RiskTier } from "../lib/types";

const tierStyles: Record<RiskTier, string> = {
  low: "bg-risk-low/10 text-risk-low",
  medium: "bg-risk-medium/10 text-risk-medium",
  high: "bg-risk-high/10 text-risk-high",
  critical: "bg-risk-critical/15 text-risk-critical animate-pulse-critical",
};

export default function RiskBadge({
  score,
  tier,
}: {
  score?: number;
  tier?: string;
}) {
  if (score == null) {
    return <span className="text-muted text-xs font-mono">{"\u2014"}</span>;
  }

  const t = (tier || "low") as RiskTier;
  const style = tierStyles[t] || tierStyles.low;

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold font-mono tabular-nums ${style}`}
    >
      {score}
    </span>
  );
}
