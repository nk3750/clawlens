import { useEffect, useState } from "react";
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

// ── Count-up hook ──────────────────────────────────────────

function useCountUp(target: number, duration = 400): number {
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    if (target === 0) return;
    const start = performance.now();
    const step = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(1, elapsed / duration);
      // Ease-out cubic
      const eased = 1 - (1 - progress) ** 3;
      setCurrent(Math.round(eased * target));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [target, duration]);

  return current;
}

// ── Stat cells ─────────────────────────────────────────────

function StatCell({ value, label, sublabel }: { value: number; label: string; sublabel: string }) {
  const display = useCountUp(value);
  return (
    <div
      className="px-4 py-3"
      style={{ backgroundColor: "var(--cl-elevated)" }}
    >
      <span
        className="font-mono text-lg font-bold block"
        style={{ color: "var(--cl-text-primary)", lineHeight: 1.2 }}
      >
        {display}
      </span>
      <span
        className="label-mono block mt-0.5"
        style={{ color: "var(--cl-text-muted)", fontSize: "10px" }}
      >
        {label}
      </span>
      <span
        className="label-mono block"
        style={{ color: "var(--cl-text-muted)", fontSize: "9px" }}
      >
        {sublabel}
      </span>
    </div>
  );
}

function RiskStatCell({ value, label }: { value: number; label: string }) {
  const display = useCountUp(value);
  const tier = riskTierFromScore(display);
  const color = riskColorRaw(tier);

  return (
    <div
      className="px-4 py-3"
      style={{
        backgroundColor: "var(--cl-elevated)",
        borderTop: `2px solid ${color}`,
      }}
    >
      <span
        className="font-mono text-lg font-bold block"
        style={{ color: "var(--cl-text-primary)", lineHeight: 1.2 }}
      >
        {display}
      </span>
      <span
        className="label-mono block mt-0.5"
        style={{ color: "var(--cl-text-muted)", fontSize: "10px" }}
      >
        {label}
      </span>
      <div className="flex items-center gap-2 mt-1.5">
        <RiskBar score={display} />
        <span
          className="label-mono shrink-0"
          style={{ color, fontSize: "9px" }}
        >
          {tier.toUpperCase()}
        </span>
      </div>
    </div>
  );
}

function RiskBar({ score }: { score: number }) {
  const tier = riskTierFromScore(score);
  const color = riskColorRaw(tier);
  const pct = Math.min(100, Math.max(0, score));

  return (
    <div className="relative w-full" style={{ height: 4 }}>
      {/* Empty track */}
      <div
        className="absolute inset-0 rounded-full"
        style={{ backgroundColor: "var(--cl-border-subtle)", opacity: 0.15 }}
      />
      {/* Filled portion */}
      <div
        className="absolute inset-y-0 left-0 rounded-full"
        style={{
          width: `${pct}%`,
          backgroundColor: color,
          boxShadow: `0 0 8px ${color}40`,
        }}
      />
      {/* Score marker */}
      {pct > 0 && (
        <div
          className="absolute rounded-full"
          style={{
            width: 6,
            height: 6,
            top: -1,
            left: `calc(${pct}% - 3px)`,
            backgroundColor: color,
          }}
        >
          {/* Breathing pulse */}
          <div
            className="absolute inset-0 rounded-full"
            style={{ backgroundColor: color, animation: "pulse 2s ease-in-out infinite" }}
          />
        </div>
      )}
    </div>
  );
}

// ── Main header ────────────────────────────────────────────

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

      {/* Identity row */}
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
      </div>

      {/* Stat grid */}
      <div
        className="grid grid-cols-2 md:grid-cols-4 mt-8 rounded-xl overflow-hidden"
        style={{ border: "1px solid var(--cl-border-subtle)" }}
      >
        <StatCell value={todayActions ?? agent.todayToolCalls} label="ACTIONS" sublabel="today" />
        <RiskStatCell value={avgRisk ?? agent.avgRiskScore} label="AVG RISK" />
        <RiskStatCell value={peakRisk ?? agent.peakRiskScore} label="PEAK RISK" />
        <StatCell value={totalSessions ?? 0} label="SESSIONS" sublabel="today" />
      </div>
    </div>
  );
}
