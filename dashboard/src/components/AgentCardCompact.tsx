import { useState } from "react";
import { Link } from "react-router-dom";
import type { AgentInfo, ActivityCategory } from "../lib/types";
import { relTime, riskColorRaw, riskTierFromScore } from "../lib/utils";
import GradientAvatar from "./GradientAvatar";

const ALL_CATEGORIES: ActivityCategory[] = [
  "exploring", "changes", "commands", "web", "comms", "data",
];

const CATEGORY_LABELS: Record<ActivityCategory, string> = {
  exploring: "exploring",
  changes: "changes",
  commands: "commands",
  web: "web",
  comms: "comms",
  data: "data",
};

interface Props {
  agent: AgentInfo;
  isLast?: boolean;
}

export default function AgentRow({ agent, isLast }: Props) {
  const isActive = agent.status === "active";
  const hasActivity = agent.todayToolCalls > 0;

  // Parse trigger context from currentContext
  const triggerLabel = parseTriggerLabel(agent.currentContext);

  return (
    <Link
      to={`/agent/${encodeURIComponent(agent.id)}`}
      className="flex items-center gap-2 px-3 py-1.5 transition-colors"
      style={{
        opacity: hasActivity ? 1 : 0.35,
        borderBottom: isLast ? undefined : "1px solid var(--cl-border-subtle)",
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "var(--cl-elevated)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = ""; }}
    >
      {/* Status dot */}
      <div className="w-2 shrink-0 flex justify-center">
        {isActive && (
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{
              backgroundColor: "var(--cl-risk-low)",
              boxShadow: "0 0 4px rgba(74, 222, 128, 0.5)",
              animation: "pulse 2s ease-in-out infinite",
            }}
          />
        )}
      </div>

      {/* Avatar */}
      <GradientAvatar agentId={agent.id} size="xs" />

      {/* Name + trigger context */}
      <div className="min-w-0 flex items-center gap-1.5" style={{ flex: "1 1 0" }}>
        <span
          className="font-sans text-sm font-semibold truncate"
          style={{ color: "var(--cl-text-primary)" }}
        >
          {agent.name}
        </span>
        {hasActivity && triggerLabel && (
          <span className="font-sans text-[11px] shrink-0" style={{ color: "var(--cl-text-muted)" }}>
            {triggerLabel}
          </span>
        )}
      </div>

      {/* Category bar (replaces sparkline) — hidden on mobile */}
      {hasActivity && (
        <div className="shrink-0 hidden sm:block">
          <CategoryBar breakdown={agent.todayActivityBreakdown} />
        </div>
      )}

      {/* Action count */}
      <span
        className="font-mono text-sm tabular-nums font-bold shrink-0"
        style={{ color: "var(--cl-text-secondary)", minWidth: 48, textAlign: "right" }}
      >
        {agent.todayToolCalls}
        <span className="font-sans text-[11px] font-normal ml-1" style={{ color: "var(--cl-text-muted)" }}>
          actions
        </span>
      </span>

      {/* Risk badge — hidden on mobile */}
      {hasActivity && (
        <span className="hidden sm:inline-block shrink-0">
          <RiskBadge score={agent.avgRiskScore} />
        </span>
      )}

      {/* Relative time */}
      <span
        className="font-mono text-[11px] shrink-0"
        style={{ color: "var(--cl-text-muted)", minWidth: 44, textAlign: "right" }}
      >
        {agent.lastActiveTimestamp ? relTime(agent.lastActiveTimestamp) : "idle"}
      </span>
    </Link>
  );
}

// ── Category Bar ──────────────────────────────────────────

function CategoryBar({ breakdown }: { breakdown: Record<ActivityCategory, number> }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const total = Object.values(breakdown).reduce((s, n) => s + n, 0);
  if (total === 0) return null;

  const categories = ALL_CATEGORIES
    .map((key) => ({ key, count: breakdown[key] }))
    .filter((c) => c.count > 0);

  return (
    <div
      className="relative"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <svg width={80} height={6} className="shrink-0 rounded-full overflow-hidden" style={{ display: "block" }}>
        {categories.reduce<{ elements: React.ReactElement[]; x: number }>(
          (acc, c) => {
            const w = (c.count / total) * 80;
            acc.elements.push(
              <rect
                key={c.key}
                x={acc.x}
                y={0}
                width={w}
                height={6}
                fill={`var(--cl-cat-${c.key})`}
                opacity={0.8}
              />,
            );
            acc.x += w;
            return acc;
          },
          { elements: [], x: 0 },
        ).elements}
      </svg>

      {/* Hover tooltip */}
      {showTooltip && (
        <div
          className="absolute z-50"
          style={{
            top: 12,
            left: "50%",
            transform: "translateX(-50%)",
            background: "var(--cl-surface)",
            border: "1px solid var(--cl-border-default)",
            borderRadius: 8,
            padding: "8px 12px",
            boxShadow: "var(--cl-shadow-card)",
            whiteSpace: "nowrap",
            opacity: 1,
            transition: "opacity 150ms",
          }}
        >
          {categories
            .sort((a, b) => b.count - a.count)
            .map((c) => (
              <div key={c.key} className="flex items-center gap-2" style={{ lineHeight: "20px" }}>
                <span
                  className="inline-block rounded-full"
                  style={{
                    width: 6,
                    height: 6,
                    backgroundColor: `var(--cl-cat-${c.key})`,
                  }}
                />
                <span className="font-sans text-[11px]" style={{ color: "var(--cl-text-secondary)" }}>
                  {CATEGORY_LABELS[c.key]}
                </span>
                <span className="font-mono text-[11px]" style={{ color: "var(--cl-text-primary)" }}>
                  {c.count}
                </span>
                <span className="font-mono text-[11px]" style={{ color: "var(--cl-text-muted)" }}>
                  {Math.round((c.count / total) * 100)}%
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

// ── Risk Badge ────────────────────────────────────────────

function RiskBadge({ score }: { score: number }) {
  const tier = riskTierFromScore(score);
  const label = tier === "critical" ? "CRIT" : tier === "medium" ? "MED" : tier.toUpperCase();
  const color = riskColorRaw(tier);

  return (
    <span
      className="font-mono text-[9px] font-bold uppercase px-1.5 py-0.5 rounded"
      style={{
        color,
        backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
        minWidth: 28,
        textAlign: "center",
        display: "inline-block",
      }}
    >
      {label}
    </span>
  );
}

// ── Trigger Context Parser ────────────────────────────────

function parseTriggerLabel(context: string | undefined): string | null {
  if (!context) return null;
  const lower = context.toLowerCase();
  if (lower.includes("cron")) return "via cron";
  if (lower.includes("telegram")) return "via telegram";
  if (lower.includes("api")) return "via API";
  if (lower.includes("interactive")) return null;
  return null;
}
