import type { AgentInfo } from "../lib/types";
import { relTime } from "../lib/utils";
import ActivityBar from "./ActivityBar";

interface Props {
  agent: AgentInfo;
  anchor: "below" | "above" | "left" | "right";
}

export default function HexTooltip({ agent, anchor }: Props) {
  const posStyle: React.CSSProperties = {
    position: "absolute",
    zIndex: 20,
    width: 260,
    ...(anchor === "below" && { top: "100%", left: "50%", transform: "translateX(-50%)", marginTop: 12 }),
    ...(anchor === "above" && { bottom: "100%", left: "50%", transform: "translateX(-50%)", marginBottom: 12 }),
    ...(anchor === "right" && { left: "100%", top: "50%", transform: "translateY(-50%)", marginLeft: 12 }),
    ...(anchor === "left" && { right: "100%", top: "50%", transform: "translateY(-50%)", marginRight: 12 }),
  };

  return (
    <div
      className="cl-card pointer-events-none"
      style={{
        ...posStyle,
        padding: 16,
        animation: "cascade-in 0.3s var(--cl-spring) both",
      }}
    >
      {/* Activity breakdown */}
      <div className="mb-3">
        <ActivityBar breakdown={agent.activityBreakdown} showLabels />
      </div>

      {/* Latest action */}
      {agent.latestAction && (
        <div className="mb-2">
          <p className="text-[12px]" style={{ color: "var(--cl-text-primary)" }}>
            {agent.latestAction}
          </p>
          {agent.latestActionTime && (
            <span className="font-mono text-[10px]" style={{ color: "var(--cl-text-muted)" }}>
              {relTime(agent.latestActionTime)}
            </span>
          )}
        </div>
      )}

      {/* Stats row */}
      <div className="flex items-center justify-between" style={{ borderTop: "1px solid var(--cl-border-subtle)", paddingTop: 8, marginTop: 4 }}>
        <span className="font-mono text-[10px]" style={{ color: "var(--cl-text-muted)" }}>
          {agent.todayToolCalls} actions today
        </span>
        {agent.currentContext && (
          <span className="text-[10px] italic" style={{ color: "var(--cl-text-muted)" }}>
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
