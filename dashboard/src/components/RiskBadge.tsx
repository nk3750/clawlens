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
  compact = false,
}: {
  score?: number;
  tier?: string;
  compact?: boolean;
}) {
  if (score == null) {
    return <span className="text-muted/40 text-xs">{"\u2014"}</span>;
  }

  const t = (tier || "low") as RiskTier;
  const style = tierStyles[t] || tierStyles.low;

  if (compact) {
    return (
      <span className={`w-1.5 h-1.5 rounded-full inline-block ${style.split(" ")[0].replace("/10", "").replace("/15", "")}`}
        style={{ backgroundColor: t === "low" ? "#34d399" : t === "medium" ? "#fbbf24" : t === "high" ? "#f87171" : "#ff4040" }}
      />
    );
  }

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold font-mono tabular-nums ${style}`}>
      {score}
    </span>
  );
}
