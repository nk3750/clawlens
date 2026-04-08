import type { AgentInfo, RiskTier } from "../lib/types";
import { riskColorRaw } from "../lib/utils";

interface Props {
  agent: AgentInfo;
  anchor: "below" | "above" | "left" | "right";
}

const TIER_SCALE: RiskTier[] = ["low", "medium", "high", "critical"];
const TIER_LABEL: Record<RiskTier, string> = {
  low: "LOW",
  medium: "MED",
  high: "HIGH",
  critical: "CRIT",
};

export default function HexTooltip({ agent, anchor }: Props) {
  const posStyle: React.CSSProperties = {
    position: "absolute",
    zIndex: 20,
    width: 240,
    ...(anchor === "below" && { top: "100%", left: "50%", transform: "translateX(-50%)", marginTop: 12 }),
    ...(anchor === "above" && { bottom: "100%", left: "50%", transform: "translateX(-50%)", marginBottom: 12 }),
    ...(anchor === "right" && { left: "100%", top: "50%", transform: "translateY(-50%)", marginLeft: 12 }),
    ...(anchor === "left" && { right: "100%", top: "50%", transform: "translateY(-50%)", marginRight: 12 }),
  };

  const blockedCount = agent.blockedCount;
  const allowedCount = Math.max(0, agent.todayToolCalls - blockedCount);

  return (
    <div
      className="cl-card pointer-events-none"
      style={{
        ...posStyle,
        padding: "12px 14px",
        animation: "cascade-in 0.3s var(--cl-spring) both",
      }}
    >
      {/* Section header */}
      <div
        className="label-mono mb-2"
        style={{ color: "var(--cl-text-muted)", fontSize: 9 }}
      >
        ACTIONS BY RISK
      </div>

      {/* Risk tier grid — always 4 columns, LOW → CRIT scale */}
      <div className="grid grid-cols-4 gap-1">
        {TIER_SCALE.map((tier) => {
          const count = agent.riskProfile[tier];
          const color = riskColorRaw(tier);
          const dim = count === 0;
          return (
            <div key={tier} className="text-center" style={{ opacity: dim ? 0.2 : 1 }}>
              <div className="font-mono text-[12px] font-medium" style={{ color }}>
                {count}
              </div>
              <div className="font-mono text-[8px]" style={{ color, opacity: 0.65 }}>
                {TIER_LABEL[tier]}
              </div>
            </div>
          );
        })}
      </div>

      {/* Divider */}
      <div style={{ borderTop: "1px solid var(--cl-border-subtle)", margin: "8px 0 7px" }} />

      {/* Decision tally + context */}
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 font-mono text-[10px]">
          <span style={{ color: "var(--cl-risk-low)" }}>
            {allowedCount} allowed
          </span>
          {blockedCount > 0 && (
            <>
              <span style={{ color: "var(--cl-text-muted)" }}>&middot;</span>
              <span
                className="px-1 py-0.5 rounded"
                style={{
                  color: "var(--cl-risk-high)",
                  backgroundColor: "rgba(248, 113, 113, 0.1)",
                }}
              >
                {blockedCount} blocked
              </span>
            </>
          )}
        </span>
        {agent.currentContext && (
          <span
            className="text-[10px] italic truncate ml-2"
            style={{ color: "var(--cl-text-muted)", maxWidth: 90 }}
          >
            {agent.currentContext}
          </span>
        )}
      </div>

      {/* Attention callout */}
      {agent.needsAttention && agent.attentionReason && (
        <div
          className="mt-2 px-2 py-1.5 rounded text-[10px]"
          style={{
            backgroundColor: "rgba(251, 191, 36, 0.08)",
            border: "1px solid rgba(251, 191, 36, 0.2)",
            color: "#fbbf24",
          }}
        >
          {agent.attentionReason}
        </div>
      )}
    </div>
  );
}
