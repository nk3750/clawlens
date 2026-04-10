import { useState } from "react";
import type { AgentInfo, StatsResponse } from "../lib/types";
import { riskColorRaw } from "../lib/utils";

interface Props {
  stats: StatsResponse;
  agents: AgentInfo[];
  isToday: boolean;
  dateLabel?: string;
}

const POSTURE_COLOR: Record<string, string> = {
  calm: riskColorRaw("low"),
  elevated: riskColorRaw("medium"),
  high: riskColorRaw("high"),
  critical: riskColorRaw("critical"),
};

const POSTURE_LABEL: Record<string, string> = {
  calm: "Calm",
  elevated: "Elevated",
  high: "High",
  critical: "Critical",
};

// ── Flip card shell ──

function FlipCard({
  front,
  back,
}: {
  front: React.ReactNode;
  back: React.ReactNode;
}) {
  const [flipped, setFlipped] = useState(false);

  return (
    <div
      className="relative cursor-pointer"
      style={{ perspective: 800, minHeight: 100 }}
      onClick={() => setFlipped((f) => !f)}
    >
      <div
        className="w-full transition-transform"
        style={{
          transformStyle: "preserve-3d",
          transitionDuration: "0.5s",
          transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
          transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
        }}
      >
        {/* Front face */}
        <div
          className="rounded-lg px-5 py-4 w-full"
          style={{
            backgroundColor: "var(--cl-surface)",
            boxShadow: "var(--cl-shadow-card)",
            backfaceVisibility: "hidden",
          }}
        >
          {front}
        </div>
        {/* Back face */}
        <div
          className="rounded-lg px-5 py-4 w-full absolute inset-0"
          style={{
            backgroundColor: "var(--cl-elevated)",
            boxShadow: "var(--cl-shadow-card)",
            backfaceVisibility: "hidden",
            transform: "rotateY(180deg)",
          }}
        >
          {back}
        </div>
      </div>
    </div>
  );
}

// ── Fleet Status card ──

function FleetStatusCard({
  stats,
  agents,
  isToday,
}: {
  stats: StatsResponse;
  agents: AgentInfo[];
  isToday: boolean;
}) {
  const color = POSTURE_COLOR[stats.riskPosture] ?? POSTURE_COLOR.calm;
  const label = POSTURE_LABEL[stats.riskPosture] ?? "Calm";
  const activeCount = agents.filter((a) => a.status === "active").length;
  const totalCount = agents.length;
  const attentionCount = agents.filter((a) => a.needsAttention).length;

  const front = (
    <>
      <div className="flex items-center justify-between mb-3">
        <span
          className="text-[10px] font-semibold tracking-widest uppercase"
          style={{ color: "var(--cl-text-muted)" }}
        >
          Fleet Status
        </span>
        <span
          className="text-[10px] font-mono"
          style={{ color: "var(--cl-text-muted)", opacity: 0.5 }}
        >
          tap to flip
        </span>
      </div>
      <div className="flex items-center gap-3">
        {attentionCount === 0 ? (
          <span style={{ color, fontSize: 18 }}>&#10003;</span>
        ) : (
          <span style={{ color: riskColorRaw("high"), fontSize: 18 }}>&#9888;</span>
        )}
        <div>
          <div
            className="text-lg font-bold"
            style={{
              color,
              textShadow: `0 0 20px ${color}30`,
            }}
          >
            {label}
          </div>
          <div
            className="text-[11px] font-mono"
            style={{ color: "var(--cl-text-muted)" }}
          >
            {isToday
              ? `${activeCount}/${totalCount} agents active`
              : `${totalCount} agents`}
          </div>
        </div>
      </div>
    </>
  );

  const attentionAgents = agents.filter((a) => a.needsAttention);
  const back = (
    <>
      <div className="flex items-center justify-between mb-3">
        <span
          className="text-[10px] font-semibold tracking-widest uppercase"
          style={{ color: "var(--cl-text-muted)" }}
        >
          Fleet Detail
        </span>
      </div>
      <div className="space-y-1.5">
        <div className="flex justify-between text-[11px] font-mono">
          <span style={{ color: "var(--cl-text-muted)" }}>Avg risk</span>
          <span style={{ color }}>{stats.avgRiskScore}</span>
        </div>
        <div className="flex justify-between text-[11px] font-mono">
          <span style={{ color: "var(--cl-text-muted)" }}>Peak risk</span>
          <span style={{ color: riskColorRaw(stats.peakRiskScore > 75 ? "critical" : stats.peakRiskScore > 50 ? "high" : stats.peakRiskScore > 25 ? "medium" : "low") }}>
            {stats.peakRiskScore}
          </span>
        </div>
        {attentionAgents.length > 0 && (
          <div className="pt-1 border-t" style={{ borderColor: "var(--cl-border-subtle)" }}>
            {attentionAgents.slice(0, 3).map((a) => (
              <div
                key={a.id}
                className="text-[11px] truncate"
                style={{ color: "var(--cl-text-secondary)" }}
              >
                <span className="font-medium" style={{ color: "var(--cl-text-primary)" }}>
                  {a.name}
                </span>{" "}
                {a.attentionReason}
              </div>
            ))}
          </div>
        )}
        {attentionAgents.length === 0 && (
          <div
            className="text-[11px] pt-1"
            style={{ color: "var(--cl-text-muted)" }}
          >
            No agents need attention
          </div>
        )}
      </div>
    </>
  );

  return <FlipCard front={front} back={back} />;
}

// ── Top Risk card ──

function TopRiskCard({ agents }: { agents: AgentInfo[] }) {
  const riskyAgents = agents
    .filter((a) => a.topRisk && a.topRisk.score >= 25)
    .sort((a, b) => (b.topRisk?.score ?? 0) - (a.topRisk?.score ?? 0));

  const top = riskyAgents[0];
  const topColor = top
    ? riskColorRaw(top.topRisk!.tier)
    : riskColorRaw("low");

  const front = (
    <>
      <div className="flex items-center justify-between mb-3">
        <span
          className="text-[10px] font-semibold tracking-widest uppercase"
          style={{ color: "var(--cl-text-muted)" }}
        >
          Top Risk
        </span>
        <span
          className="text-[10px] font-mono"
          style={{ color: "var(--cl-text-muted)", opacity: 0.5 }}
        >
          tap to flip
        </span>
      </div>
      {top ? (
        <div className="flex items-center gap-3">
          <span
            className="text-xl font-bold font-mono"
            style={{
              color: topColor,
              textShadow: `0 0 20px ${topColor}30`,
            }}
          >
            {top.topRisk!.score}
          </span>
          <div className="min-w-0">
            <div
              className="text-[12px] font-medium truncate"
              style={{ color: "var(--cl-text-primary)" }}
            >
              {top.name}
            </div>
            <div
              className="text-[11px] truncate"
              style={{ color: "var(--cl-text-muted)" }}
            >
              {top.topRisk!.description}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <span style={{ color: riskColorRaw("low"), fontSize: 18 }}>&#10003;</span>
          <div
            className="text-[12px]"
            style={{ color: "var(--cl-text-muted)" }}
          >
            No elevated risks
          </div>
        </div>
      )}
    </>
  );

  const back = (
    <>
      <div className="flex items-center justify-between mb-3">
        <span
          className="text-[10px] font-semibold tracking-widest uppercase"
          style={{ color: "var(--cl-text-muted)" }}
        >
          Risk Hotspots
        </span>
      </div>
      <div className="space-y-1.5">
        {riskyAgents.length === 0 && (
          <div
            className="text-[11px]"
            style={{ color: "var(--cl-text-muted)" }}
          >
            All agents operating within normal range
          </div>
        )}
        {riskyAgents.slice(0, 4).map((a) => (
          <div
            key={a.id}
            className="flex items-center justify-between text-[11px] font-mono"
          >
            <span
              className="truncate"
              style={{ color: "var(--cl-text-secondary)", maxWidth: "60%" }}
            >
              {a.name}
            </span>
            <span style={{ color: riskColorRaw(a.topRisk!.tier) }}>
              {a.topRisk!.score}{" "}
              <span className="uppercase text-[9px]">{a.topRisk!.tier}</span>
            </span>
          </div>
        ))}
      </div>
    </>
  );

  return <FlipCard front={front} back={back} />;
}

// ── Main component ──

export default function FleetBriefing({ stats, agents }: Props) {
  if (stats.total === 0 && agents.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-4 mx-auto max-w-2xl max-sm:grid-cols-1">
      <FleetStatusCard stats={stats} agents={agents} isToday={stats.activeAgents > 0} />
      <TopRiskCard agents={agents} />
    </div>
  );
}
