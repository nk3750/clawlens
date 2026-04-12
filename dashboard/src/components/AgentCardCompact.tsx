import { Link } from "react-router-dom";
import type { AgentInfo, ActivityCategory } from "../lib/types";
import { CATEGORY_META, relTime, riskColorRaw, riskTierFromScore } from "../lib/utils";
import GradientAvatar from "./GradientAvatar";

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
}

export default function AgentCard({ agent }: Props) {
  const isActive = agent.status === "active";
  const hasActivity = agent.todayToolCalls > 0;
  const triggerLabel = parseTriggerLabel(agent.currentContext, agent.mode);

  return (
    <Link
      to={`/agent/${encodeURIComponent(agent.id)}`}
      className="block rounded-xl transition-colors"
      style={{
        backgroundColor: "var(--cl-surface)",
        border: "1px solid var(--cl-border-subtle)",
        padding: 12,
        opacity: hasActivity ? 1 : 0.35,
        textDecoration: "none",
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "var(--cl-elevated)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "var(--cl-surface)"; }}
    >
      {/* Line 1: Identity */}
      <div className="flex items-center gap-2">
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
        <GradientAvatar agentId={agent.id} size="xs" />
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
        {hasActivity && (
          <span className="ml-auto shrink-0">
            <RiskBadge score={agent.avgRiskScore} />
          </span>
        )}
      </div>

      {/* Category breakdown bars */}
      {hasActivity && (
        <div className="mt-2.5 mb-1">
          <CategoryBreakdown breakdown={agent.todayActivityBreakdown} />
        </div>
      )}

      {/* Bottom: Stats */}
      <div className="flex items-center gap-2 mt-2">
        <span
          className="font-mono text-sm tabular-nums font-bold"
          style={{ color: "var(--cl-text-secondary)" }}
        >
          {agent.todayToolCalls}
          <span className="font-sans text-[11px] font-normal ml-1" style={{ color: "var(--cl-text-muted)" }}>
            actions
          </span>
        </span>
        <span
          className="font-mono text-[11px] ml-auto"
          style={{ color: "var(--cl-text-muted)" }}
        >
          {agent.lastActiveTimestamp ? relTime(agent.lastActiveTimestamp) : "idle"}
        </span>
      </div>
    </Link>
  );
}

// ── Category Breakdown ───────────────────────────────────

function CategoryBreakdown({ breakdown }: { breakdown: Record<ActivityCategory, number> }) {
  const total = Object.values(breakdown).reduce((s, n) => s + n, 0);
  if (total === 0) return null;

  const categories = (Object.entries(breakdown) as [ActivityCategory, number][])
    .filter(([, count]) => count > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 4);

  return (
    <div className="flex flex-col gap-1.5">
      {categories.map(([cat, count]) => {
        const meta = CATEGORY_META[cat];
        const pct = Math.round((count / total) * 100);
        return (
          <div key={cat} className="flex items-center gap-1.5">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke={meta.color}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0"
            >
              <path d={meta.iconPath} />
            </svg>
            <span
              className="font-sans text-[10px] shrink-0"
              style={{ color: "var(--cl-text-muted)", minWidth: 52 }}
            >
              {CATEGORY_LABELS[cat]}
            </span>
            <div className="flex-1" style={{ height: 4, borderRadius: 2, backgroundColor: "var(--cl-elevated)" }}>
              <div
                style={{
                  width: `${pct}%`,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: meta.color,
                  opacity: 0.8,
                }}
              />
            </div>
            <span
              className="font-mono text-[10px] shrink-0"
              style={{ color: "var(--cl-text-muted)", minWidth: 24, textAlign: "right" }}
            >
              {pct}%
            </span>
          </div>
        );
      })}
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

function parseTriggerLabel(context: string | undefined, mode?: string): string | null {
  if (context) {
    const lower = context.toLowerCase();
    if (lower.includes("cron")) return "via cron";
    if (lower.includes("telegram")) return "via telegram";
    if (lower.includes("api")) return "via API";
    if (lower.includes("interactive")) return null;
  }
  if (mode === "scheduled") return "via cron";
  return null;
}
