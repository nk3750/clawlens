import { useNavigate } from "react-router-dom";
import type { RiskTier } from "../lib/types";

interface Props {
  mix: Record<RiskTier, number>;
  /** Canonical denominator (matches the microbar's width math). */
  total?: number;
  /** Used to build the click-through `/activity?agent=<id>&tier=<worst>` link. */
  agentId: string;
}

const DRAW_ORDER: RiskTier[] = ["low", "medium", "high", "critical"];

const TIER_COLORS: Record<RiskTier, string> = {
  low: "var(--cl-risk-low)",
  medium: "var(--cl-risk-medium)",
  high: "var(--cl-risk-high)",
  critical: "var(--cl-risk-critical)",
};

/** Highest-severity tier with a non-zero count, or `low` if nothing non-low. */
function worstPresentTier(mix: Record<RiskTier, number>): RiskTier {
  if (mix.critical > 0) return "critical";
  if (mix.high > 0) return "high";
  if (mix.medium > 0) return "medium";
  return "low";
}

/**
 * Rich hover content for the RiskMixMicrobar. Owns layout/copy only — the
 * microbar is responsible for mounting, positioning, hover-delay orchestration,
 * and dismissal. Separating these concerns keeps the popover testable in
 * isolation (pure-props rendering) and keeps the microbar's hover logic from
 * drowning in JSX.
 */
export default function RiskMixPopover({ mix, total, agentId }: Props) {
  const navigate = useNavigate();
  const sum = mix.low + mix.medium + mix.high + mix.critical;
  const denominator = total ?? sum;
  if (denominator <= 0) return null;

  const worst = worstPresentTier(mix);
  const targetHref = `/activity?agent=${encodeURIComponent(agentId)}&tier=${worst}`;

  return (
    <div
      role="tooltip"
      aria-live="polite"
      data-cl-risk-mix-popover
      className="cl-card"
      style={{
        position: "absolute",
        top: "calc(100% + 6px)",
        left: 0,
        minWidth: 240,
        padding: "10px 12px",
        borderRadius: "var(--cl-r-md)",
        boxShadow: "var(--cl-depth-pop)",
        backgroundColor: "var(--cl-bg-popover)",
        border: "1px solid var(--cl-border)",
        // mirrors --cl-z-tooltip in index.css; numeric literal avoids the string-cast
        zIndex: 80,
        animation: "cl-pop-in 160ms cubic-bezier(0.34, 1.56, 0.64, 1) both",
        transformOrigin: "top left",
      }}
    >
      <div
        data-cl-risk-mix-pop-header
        style={{
          color: "var(--cl-text-secondary)",
          fontFamily: "var(--cl-font-mono)",
          fontFeatureSettings: "normal",
          fontSize: 10,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          marginBottom: 8,
        }}
      >
        Risk today · {denominator} scored actions
      </div>

      <div className="flex flex-col" style={{ gap: 3 }}>
        {DRAW_ORDER.map((tier) => {
          const count = mix[tier];
          if (count <= 0) return null;
          const pct = Math.round((count / denominator) * 100);
          return (
            <div
              key={tier}
              data-cl-risk-mix-pop-row={tier}
              className="flex items-center"
              style={{ gap: 8 }}
            >
              <span
                data-cl-risk-mix-pop-dot
                aria-hidden="true"
                style={{
                  display: "inline-block",
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  backgroundColor: TIER_COLORS[tier],
                  flexShrink: 0,
                }}
              />
              <span
                className="tabular-nums"
                style={{
                  color: "var(--cl-text-primary)",
                  fontFamily: "var(--cl-font-mono)",
                  fontFeatureSettings: "normal",
                  fontSize: 11,
                  minWidth: "4ch",
                  textAlign: "right",
                }}
              >
                {pct}%
              </span>
              <span
                style={{
                  color: "var(--cl-text-secondary)",
                  fontFamily: "var(--cl-font-mono)",
                  fontFeatureSettings: "normal",
                  fontSize: 11,
                  minWidth: "8ch",
                }}
              >
                {tier}
              </span>
              <span
                className="tabular-nums"
                style={{
                  marginLeft: "auto",
                  color: "var(--cl-text-muted)",
                  fontFamily: "var(--cl-font-mono)",
                  fontFeatureSettings: "normal",
                  fontSize: 11,
                  minWidth: "3ch",
                  textAlign: "right",
                }}
              >
                {count}
              </span>
            </div>
          );
        })}
      </div>

      <div
        style={{
          height: 1,
          backgroundColor: "var(--cl-border)",
          margin: "8px 0",
        }}
      />

      <div
        data-cl-risk-mix-pop-narrative
        style={{
          color: TIER_COLORS[worst],
          fontFamily: "var(--cl-font-mono)",
          fontFeatureSettings: "normal",
          fontSize: 11,
          marginBottom: 6,
        }}
      >
        Peak tier today: {worst}
      </div>

      <button
        type="button"
        data-cl-risk-mix-pop-link
        // stopPropagation prevents the wrapping card <Link to="/agent/:id">
        // from also firing. <button> avoids the nested-anchor HTML invalid
        // state that <Link> created here (validateDOMNesting + repair races).
        onClick={(e) => {
          e.stopPropagation();
          navigate(targetHref);
        }}
        style={{
          color: "var(--cl-accent)",
          fontFamily: "var(--cl-font-mono)",
          fontFeatureSettings: "normal",
          fontSize: 11,
          textDecoration: "none",
          display: "inline-block",
          background: "transparent",
          border: "none",
          padding: 0,
          cursor: "pointer",
        }}
      >
        View filtered activity →
      </button>
    </div>
  );
}
