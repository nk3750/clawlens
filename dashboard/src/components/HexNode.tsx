import { useState } from "react";
import { Link } from "react-router-dom";
import type { AgentInfo } from "../lib/types";
import { riskTierFromScore, riskColorRaw } from "../lib/utils";
import GradientAvatar from "./GradientAvatar";
import HexTooltip from "./HexTooltip";

interface Props {
  agent: AgentInfo;
  position: { x: number; y: number };
  tooltipAnchor: "below" | "above" | "left" | "right";
  onHover: (id: string | null) => void;
}

export default function HexNode({ agent, position, tooltipAnchor, onHover }: Props) {
  const [hovered, setHovered] = useState(false);
  const tierColor = riskColorRaw(riskTierFromScore(agent.avgRiskScore));

  const handleEnter = () => {
    setHovered(true);
    onHover(agent.id);
  };
  const handleLeave = () => {
    setHovered(false);
    onHover(null);
  };

  return (
    <div
      className="hex-node"
      style={{
        left: `${position.x * 100}%`,
        top: `${position.y * 100}%`,
      }}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onFocus={handleEnter}
      onBlur={handleLeave}
    >
      <Link
        to={`/agent/${encodeURIComponent(agent.id)}`}
        className="flex flex-col items-center gap-2 text-center outline-none"
        style={{
          transition: "transform var(--cl-spring-duration) var(--cl-spring)",
          transform: hovered ? "scale(1.12)" : "scale(1)",
        }}
      >
        {/* Avatar with risk glow ring */}
        <div className="relative">
          {/* Attention badge */}
          {agent.needsAttention && (
            <div
              className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center z-10 attention-pulse"
              style={{
                backgroundColor: "rgba(251, 191, 36, 0.2)",
                border: "1px solid rgba(251, 191, 36, 0.4)",
              }}
            >
              <span className="text-[8px] text-yellow-400 font-bold">!</span>
            </div>
          )}

          {/* Glow ring */}
          <div
            className="absolute inset-0 rounded-full"
            style={{
              margin: -4,
              border: `2px solid ${tierColor}`,
              opacity: hovered ? 0.6 : 0.25,
              boxShadow: hovered
                ? `0 0 20px ${tierColor}50, 0 0 40px ${tierColor}20`
                : `0 0 10px ${tierColor}20`,
              transition: "opacity 0.4s ease, box-shadow 0.5s ease",
              borderRadius: "50%",
            }}
          />
          <GradientAvatar agentId={agent.id} size="md" />
        </div>

        {/* Name */}
        <span
          className="font-display font-bold text-[14px] whitespace-nowrap"
          style={{ color: "var(--cl-text-primary)" }}
        >
          {agent.name}
        </span>

        {/* Risk score badge */}
        <div className="flex items-center gap-2">
          <span
            className="font-mono text-[12px] font-medium px-2 py-0.5 rounded-full"
            style={{
              color: tierColor,
              backgroundColor: `${tierColor}12`,
              border: `1px solid ${tierColor}25`,
            }}
          >
            {agent.avgRiskScore}
          </span>
          <StatusDot agent={agent} />
        </div>
      </Link>

      {/* Tooltip on hover */}
      {hovered && <HexTooltip agent={agent} anchor={tooltipAnchor} />}
    </div>
  );
}

function StatusDot({ agent }: { agent: AgentInfo }) {
  if (agent.mode === "scheduled") {
    return (
      <span className="flex items-center gap-1">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2.5" strokeLinecap="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        <span className="font-mono text-[9px]" style={{ color: "#a78bfa" }}>
          {agent.schedule ?? "cron"}
        </span>
      </span>
    );
  }

  if (agent.status === "active") {
    return (
      <span className="flex items-center gap-1">
        <span
          className="inline-block w-[5px] h-[5px] rounded-full"
          style={{
            backgroundColor: "var(--cl-risk-low)",
            boxShadow: "0 0 6px rgba(74, 222, 128, 0.5)",
            animation: "pulse 2s ease-in-out infinite",
          }}
        />
        <span className="font-mono text-[9px]" style={{ color: "var(--cl-risk-low)" }}>
          Active
        </span>
      </span>
    );
  }

  return (
    <span className="font-mono text-[9px]" style={{ color: "var(--cl-text-muted)" }}>
      idle
    </span>
  );
}
