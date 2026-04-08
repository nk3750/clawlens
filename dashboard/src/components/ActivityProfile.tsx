import type { ActivityCategory, RiskTier } from "../lib/types";
import { CATEGORY_META, riskColorRaw } from "../lib/utils";

interface Props {
  breakdown: Record<ActivityCategory, number>;
  sessionActions?: number;
  todayActions?: number;
  decisionCounts?: Record<string, number>;
  tierCounts?: Record<RiskTier, number>;
}

const ORDERED: ActivityCategory[] = [
  "exploring", "changes", "commands", "web", "comms", "data",
];

export default function ActivityProfile({ breakdown, sessionActions, todayActions, decisionCounts, tierCounts }: Props) {
  const active = ORDERED.filter((cat) => breakdown[cat] > 0).sort(
    (a, b) => breakdown[b] - breakdown[a],
  );

  if (active.length === 0) {
    return (
      <div className="label-mono" style={{ color: "var(--cl-text-muted)" }}>
        No activity data
      </div>
    );
  }

  const maxPct = Math.max(...active.map((c) => breakdown[c]));

  return (
    <div>
      <div className="space-y-3">
        {active.map((cat) => {
          const meta = CATEGORY_META[cat];
          const pct = breakdown[cat];
          return (
            <div key={cat} className="flex items-center gap-3">
              {/* SVG icon */}
              <svg
                width="16"
                height="16"
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

              {/* Label */}
              <span
                className="label-mono shrink-0"
                style={{ color: "var(--cl-text-secondary)", minWidth: "7em" }}
              >
                {meta.label}
              </span>

              {/* Bar */}
              <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ backgroundColor: "var(--cl-elevated)" }}>
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${(pct / maxPct) * 100}%`,
                    backgroundColor: meta.color,
                    boxShadow: `0 0 8px ${meta.color}40`,
                  }}
                />
              </div>

              {/* Percentage */}
              <span
                className="label-mono shrink-0 text-right"
                style={{ color: "var(--cl-text-secondary)", minWidth: "3em" }}
              >
                {pct}%
              </span>
            </div>
          );
        })}
      </div>

      {/* Action counts footer */}
      {(sessionActions != null || todayActions != null) && (
        <p className="label-mono mt-5" style={{ color: "var(--cl-text-muted)" }}>
          {sessionActions != null && <>{sessionActions} actions this session</>}
          {sessionActions != null && todayActions != null && " \u00b7 "}
          {todayActions != null && <>{todayActions} actions today</>}
        </p>
      )}

      {/* Decision summary */}
      {decisionCounts && Object.keys(decisionCounts).length > 0 && (
        <>
          <div className="cl-divider my-5" />
          <h3 className="label-mono mb-3" style={{ color: "var(--cl-text-muted)" }}>
            DECISIONS
          </h3>
          <div className="flex items-center gap-1.5 flex-wrap font-mono text-xs">
            <DecisionItems counts={decisionCounts} />
          </div>
        </>
      )}

      {/* Risk tier distribution */}
      {tierCounts && (
        <>
          <div className="cl-divider my-5" />
          <h3 className="label-mono mb-3" style={{ color: "var(--cl-text-muted)" }}>
            RISK PROFILE
          </h3>
          <TierDistribution counts={tierCounts} />
        </>
      )}
    </div>
  );
}

const DECISION_COLORS: Record<string, string> = {
  allow: "var(--cl-risk-low)",
  block: "var(--cl-risk-high)",
  approve: "var(--cl-accent)",
  approved: "var(--cl-accent)",
  pending: "var(--cl-text-secondary)",
  denied: "var(--cl-risk-high)",
  timeout: "var(--cl-text-muted)",
};

const DECISION_LABEL: Record<string, string> = {
  allow: "allowed",
  block: "blocked",
  approve: "approved",
  approved: "approved",
  pending: "pending",
  denied: "denied",
  timeout: "timed out",
};

function DecisionItems({ counts }: { counts: Record<string, number> }) {
  const items = Object.entries(counts).filter(([, v]) => v > 0);
  return (
    <>
      {items.map(([decision, count], i) => {
        const color = DECISION_COLORS[decision] ?? "var(--cl-text-secondary)";
        const label = DECISION_LABEL[decision] ?? decision;
        const isBlocked = decision === "block" && count > 0;
        return (
          <span key={decision} className="flex items-center gap-1.5">
            {i > 0 && <span style={{ color: "var(--cl-text-muted)" }}>&middot;</span>}
            <span
              className={isBlocked ? "px-1.5 py-0.5 rounded" : undefined}
              style={{
                color,
                backgroundColor: isBlocked ? "rgba(248,113,113,0.1)" : undefined,
              }}
            >
              {count} {label}
            </span>
          </span>
        );
      })}
    </>
  );
}

const TIER_ORDER: RiskTier[] = ["critical", "high", "medium", "low"];

function TierDistribution({ counts }: { counts: Record<RiskTier, number> }) {
  const active = TIER_ORDER.filter((t) => counts[t] > 0);
  if (active.length === 0) return null;

  const maxCount = Math.max(...active.map((t) => counts[t]));

  return (
    <div className="space-y-2">
      {active.map((tier) => {
        const color = riskColorRaw(tier);
        const count = counts[tier];
        const widthPct = (count / maxCount) * 100;
        const isCritical = tier === "critical";
        return (
          <div key={tier} className="flex items-center gap-3">
            <span
              className="label-mono shrink-0"
              style={{ color, minWidth: "5em" }}
            >
              {tier.toUpperCase()}
            </span>
            <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "var(--cl-elevated)" }}>
              <div
                className="h-full rounded-full"
                style={{
                  width: `${widthPct}%`,
                  backgroundColor: color,
                  boxShadow: isCritical ? `0 0 8px ${color}40` : undefined,
                }}
              />
            </div>
            <span
              className="font-mono text-xs shrink-0 text-right"
              style={{ color: "var(--cl-text-secondary)", minWidth: "2em" }}
            >
              {count}
            </span>
          </div>
        );
      })}
    </div>
  );
}
