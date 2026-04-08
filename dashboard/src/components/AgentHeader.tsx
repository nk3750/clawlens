import { Link } from "react-router-dom";
import type { AgentInfo } from "../lib/types";
import { relTime, riskColorRaw, riskTierFromScore } from "../lib/utils";
import GradientAvatar from "./GradientAvatar";

interface Props {
  agent: AgentInfo;
  todayActions?: number;
  avgRisk?: number;
  peakRisk?: number;
  totalSessions?: number;
}

export default function AgentHeader({ agent, todayActions, avgRisk, peakRisk, totalSessions }: Props) {
  const tier = riskTierFromScore(agent.avgRiskScore);
  const haloColor = riskColorRaw(tier);

  const statusDot = agent.status === "active" ? (
    <svg width="8" height="8" viewBox="0 0 8 8" className="inline-block mr-1.5">
      <circle cx="4" cy="4" r="3" fill="var(--cl-risk-low)">
        <animate attributeName="opacity" values="1;0.35;1" dur="2s" repeatCount="indefinite" />
      </circle>
    </svg>
  ) : agent.mode === "scheduled" ? (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--cl-cat-commands)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline-block mr-1.5">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  ) : null;

  const statusText = agent.status === "active"
    ? `Active${agent.currentSession ? ` \u00b7 since ${relTime(agent.currentSession.startTime)}` : ""}`
    : `Idle${agent.lastActiveTimestamp ? ` \u00b7 ${relTime(agent.lastActiveTimestamp)}` : ""}`;

  const scheduleText = agent.mode === "scheduled" && agent.schedule
    ? ` \u00b7 ${agent.schedule}`
    : "";

  return (
    <div className="mb-8">
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-sm mb-8 group"
        style={{ color: "var(--cl-text-muted)" }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="transition-transform group-hover:-translate-x-1" style={{ transitionDuration: "var(--cl-spring-duration)", transitionTimingFunction: "var(--cl-spring)" }}>
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Back to Agents
      </Link>

      <div className="flex items-center gap-5 relative">
        {/* Atmospheric halo behind avatar */}
        <div className="relative shrink-0">
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background: `radial-gradient(circle, ${haloColor}20 0%, transparent 70%)`,
              filter: "blur(20px)",
              transform: "scale(2.2)",
            }}
          />
          <GradientAvatar agentId={agent.id} size="lg" />
        </div>

        <div className="min-w-0 flex-1">
          <h1
            className="font-display font-bold"
            style={{
              fontSize: "var(--text-heading)",
              color: "var(--cl-text-primary)",
              lineHeight: 1.2,
            }}
          >
            {agent.name}
          </h1>
          <div className="flex items-center gap-0.5 mt-1.5">
            {statusDot}
            <span className="font-mono text-xs" style={{ color: "var(--cl-text-secondary)" }}>
              {statusText}{scheduleText}
            </span>
          </div>
          {agent.currentContext && (
            <p
              className="italic text-sm mt-1"
              style={{ color: "var(--cl-text-muted)" }}
            >
              &ldquo;{agent.currentContext}&rdquo;
            </p>
          )}
        </div>

        {/* Stat pills */}
        <div className="hidden md:flex items-center gap-6 shrink-0">
          <StatPill value={todayActions ?? agent.todayToolCalls} label="actions" sublabel="today" />
          <StatPill
            value={avgRisk ?? agent.avgRiskScore}
            label="avg"
            sublabel={riskTierFromScore(avgRisk ?? agent.avgRiskScore).toUpperCase()}
            color={riskColorRaw(riskTierFromScore(avgRisk ?? agent.avgRiskScore))}
          />
          <StatPill
            value={peakRisk ?? agent.peakRiskScore}
            label="peak"
            sublabel={riskTierFromScore(peakRisk ?? agent.peakRiskScore).toUpperCase()}
            color={riskColorRaw(riskTierFromScore(peakRisk ?? agent.peakRiskScore))}
          />
          <StatPill value={totalSessions ?? 0} label="sessions" sublabel="today" />
        </div>
      </div>

      <div className="cl-divider mt-8" />
    </div>
  );
}

function StatPill({
  value,
  label,
  sublabel,
  color,
}: {
  value: number;
  label: string;
  sublabel: string;
  color?: string;
}) {
  return (
    <div className="flex flex-col items-center text-center">
      <span
        className="font-mono text-lg font-bold"
        style={{ color: color ?? "var(--cl-text-primary)", lineHeight: 1.2 }}
      >
        {value}
      </span>
      <span className="label-mono" style={{ color: "var(--cl-text-muted)", fontSize: "10px" }}>
        {label}
      </span>
      <span
        className="label-mono"
        style={{
          color: color ?? "var(--cl-text-muted)",
          fontSize: "9px",
        }}
      >
        {sublabel}
      </span>
    </div>
  );
}
