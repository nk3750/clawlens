import { Link } from "react-router-dom";
import type { AgentInfo } from "../lib/types";
import { relTime, riskColorRaw } from "../lib/utils";
import GradientAvatar from "./GradientAvatar";

interface Props {
  agent: AgentInfo;
  guardrailCount: number;
  isTopAgent?: boolean;
}

export default function AgentCardCompact({ agent, guardrailCount, isTopAgent }: Props) {
  const borderColor = isTopAgent
    ? "var(--cl-accent)"
    : agent.status === "active"
      ? riskColorRaw("low")
      : undefined;

  return (
    <Link
      to={`/agent/${encodeURIComponent(agent.id)}`}
      className="block rounded-xl px-4 py-3 transition-all"
      style={{
        backgroundColor: "var(--cl-surface)",
        border: "1px solid var(--cl-border)",
        boxShadow: borderColor ? `inset 3px 0 0 0 ${borderColor}` : undefined,
      }}
    >
      <div className="flex items-center gap-3">
        {/* Avatar */}
        <GradientAvatar agentId={agent.id} size="sm" />

        {/* Name + status */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className="text-sm font-semibold truncate"
              style={{ color: "var(--cl-text-primary)" }}
            >
              {agent.name}
            </span>
            {agent.needsAttention && (
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#fbbf24"
                strokeWidth="2.5"
                strokeLinecap="round"
              >
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z M12 9v4 M12 17h.01" />
              </svg>
            )}
          </div>
          <StatusLine agent={agent} />
        </div>

        {/* Action count */}
        <div className="text-right shrink-0">
          <span
            className="font-mono text-lg font-bold leading-none"
            style={{ color: "var(--cl-text-primary)" }}
          >
            {agent.todayToolCalls}
          </span>
          <span
            className="block font-mono text-[10px] uppercase"
            style={{ color: "var(--cl-text-muted)" }}
          >
            actions
          </span>
        </div>

        {/* Guardrail shield */}
        {guardrailCount > 0 && (
          <span
            className="flex items-center gap-0.5 shrink-0 font-mono text-[10px]"
            style={{ color: "var(--cl-text-muted)" }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            {guardrailCount}
          </span>
        )}
      </div>

      {/* Latest action — own line, full width */}
      {agent.latestAction && (
        <div className="mt-2 ml-11 truncate">
          <span
            className="text-[11px]"
            style={{ color: "var(--cl-text-secondary)" }}
          >
            {agent.latestAction}
          </span>
          {agent.latestActionTime && (
            <span
              className="font-mono text-[11px] ml-1"
              style={{ color: "var(--cl-text-muted)" }}
            >
              {relTime(agent.latestActionTime)}
            </span>
          )}
        </div>
      )}
    </Link>
  );
}

function ScheduledIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--cl-text-muted)"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function StatusLine({ agent }: { agent: AgentInfo }) {
  if (agent.status === "active") {
    return (
      <span className="flex items-center gap-1 mt-0.5">
        <span
          className="inline-block w-1 h-1 rounded-full"
          style={{
            backgroundColor: "var(--cl-risk-low)",
            boxShadow: "0 0 4px rgba(74, 222, 128, 0.5)",
            animation: "pulse 2s ease-in-out infinite",
          }}
        />
        <span className="font-mono text-[10px]" style={{ color: "var(--cl-risk-low)" }}>
          Active
        </span>
        {agent.mode === "scheduled" && <ScheduledIcon />}
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1 font-mono text-[10px] mt-0.5" style={{ color: "var(--cl-text-muted)" }}>
      <span>{agent.lastActiveTimestamp ? relTime(agent.lastActiveTimestamp) : "idle"}</span>
      {agent.mode === "scheduled" && <ScheduledIcon />}
    </span>
  );
}
