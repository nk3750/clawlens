import { Link } from "react-router-dom";
import type { AgentInfo, ActivityCategory, RiskTier } from "../lib/types";
import { CATEGORY_META, relTime, riskTierFromScore } from "../lib/utils";
import { useSessionSummary } from "../hooks/useSessionSummary";
import GradientAvatar from "./GradientAvatar";

const CATEGORY_LABELS: Record<ActivityCategory, string> = {
  exploring: "exploring",
  changes: "changes",
  commands: "commands",
  web: "web",
  comms: "comms",
  data: "data",
};

const TIER_SHORT: Record<RiskTier, "low" | "med" | "high" | "crit"> = {
  low: "low",
  medium: "med",
  high: "high",
  critical: "crit",
};

const TIER_LABEL: Record<RiskTier, string> = {
  low: "LOW",
  medium: "MED",
  high: "HIGH",
  critical: "CRIT",
};

interface Props {
  agent: AgentInfo;
  /** From AttentionResponse.agentAttention. Prefer this over agent.needsAttention when provided. */
  needsAttention?: boolean;
}

export default function AgentCard({ agent, needsAttention }: Props) {
  const isActive = agent.status === "active";
  const hasActivity = agent.todayToolCalls > 0;
  const attentionFlag = needsAttention ?? agent.needsAttention;
  const triggerLabel = parseTriggerLabel(agent.currentContext, agent.mode, agent.schedule);
  const sessionKey = agent.lastSessionKey ?? agent.currentSession?.sessionKey ?? null;
  const { summary, loading: summaryLoading, generate: fetchSummary } = useSessionSummary(sessionKey ?? "");
  const tier = riskTierFromScore(agent.avgRiskScore);

  return (
    <Link
      to={`/agent/${encodeURIComponent(agent.id)}`}
      className="cl-card block"
      data-cl-agent-attention={attentionFlag ? "true" : undefined}
      style={{
        padding: "14px 16px",
        opacity: hasActivity ? 1 : 0.35,
        textDecoration: "none",
        transition: "background-color var(--cl-dur-fast) var(--cl-ease)",
        boxShadow: attentionFlag ? "inset 2px 0 0 0 var(--cl-risk-medium)" : undefined,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.backgroundColor = "var(--cl-bg-05)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.backgroundColor = "";
      }}
    >
      {/* Line 1: Identity */}
      <div className="flex items-center gap-2">
        <div className="w-2 shrink-0 flex justify-center">
          {isActive && (
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{
                backgroundColor: "var(--cl-risk-low)",
                animation: "pulse 2s ease-in-out infinite",
              }}
            />
          )}
        </div>
        <GradientAvatar agentId={agent.id} size="xs" />
        <span
          className="truncate"
          style={{
            color: "var(--cl-text-primary)",
            fontFamily: "var(--cl-font-sans)",
            fontSize: 14,
            fontWeight: 510,
            letterSpacing: "-0.01em",
          }}
        >
          {agent.name}
        </span>
        {hasActivity && triggerLabel && (
          <span
            className="shrink-0"
            style={{
              color: "var(--cl-text-muted)",
              fontFamily: "var(--cl-font-mono)",
              fontFeatureSettings: "normal",
              fontSize: 10,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            {triggerLabel}
          </span>
        )}
        {hasActivity && (
          <span className="ml-auto shrink-0">
            <span className={`cl-tier cl-tier-${TIER_SHORT[tier]}`}>{TIER_LABEL[tier]}</span>
          </span>
        )}
      </div>

      {/* Category breakdown bars — Stage C monochrome (no --cl-cat-* tokens) */}
      {hasActivity && (
        <div className="mt-2.5 mb-1">
          <CategoryBreakdown breakdown={agent.todayActivityBreakdown} />
        </div>
      )}

      {/* AI Summary — rendered as its own line below the footer when loaded */}
      {hasActivity && sessionKey && summary && (
        <p
          className="mt-2 mb-0.5"
          style={{
            color: "var(--cl-text-secondary)",
            fontFamily: "var(--cl-font-sans)",
            fontSize: 12,
            lineHeight: 1.5,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {summary}
        </p>
      )}

      {/* Bottom footer: count · time  ·····  Summarize (right-aligned) */}
      <div className="flex items-center gap-2 mt-2">
        <span
          className="tabular-nums"
          style={{
            color: "var(--cl-text-primary)",
            fontFamily: "var(--cl-font-mono)",
            fontFeatureSettings: "normal",
            fontSize: 13,
            fontWeight: 510,
          }}
        >
          {agent.todayToolCalls}
          <span
            className="ml-1"
            style={{
              color: "var(--cl-text-muted)",
              fontFamily: "var(--cl-font-sans)",
              fontSize: 12,
              fontWeight: 400,
            }}
          >
            actions
          </span>
        </span>
        {agent.lastActiveTimestamp && (
          <>
            <span
              aria-hidden="true"
              style={{ color: "var(--cl-text-subdued)", fontSize: 12 }}
            >
              ·
            </span>
            <span
              style={{
                color: "var(--cl-text-subdued)",
                fontFamily: "var(--cl-font-mono)",
                fontFeatureSettings: "normal",
                fontSize: 12,
              }}
            >
              {relTime(agent.lastActiveTimestamp)}
            </span>
          </>
        )}
        {hasActivity && sessionKey && !summary && (
          <span className="ml-auto shrink-0">
            {summaryLoading ? (
              <span
                style={{
                  color: "var(--cl-text-muted)",
                  fontFamily: "var(--cl-font-mono)",
                  fontFeatureSettings: "normal",
                  fontSize: 12,
                  fontStyle: "italic",
                }}
              >
                Summarizing…
              </span>
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  fetchSummary();
                }}
                style={{
                  color: "var(--cl-text-muted)",
                  fontFamily: "var(--cl-font-mono)",
                  fontFeatureSettings: "normal",
                  fontSize: 12,
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                  transition: "color var(--cl-dur-fast) var(--cl-ease)",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.color = "var(--cl-accent)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.color = "var(--cl-text-muted)";
                }}
              >
                summarize
              </button>
            )}
          </span>
        )}
      </div>
    </Link>
  );
}

// ── Category Breakdown ───────────────────────────────────

function CategoryBreakdown({ breakdown }: { breakdown: Record<ActivityCategory, number> }) {
  const total = Object.values(breakdown).reduce((s, n) => s + n, 0);
  if (total === 0) return null;

  const allSurfaced = (Object.entries(breakdown) as [ActivityCategory, number][])
    .filter(([, count]) => count > 0)
    .sort(([, a], [, b]) => b - a);
  const shown = allSurfaced.slice(0, 4);
  const overflow = allSurfaced.length - shown.length;

  return (
    <div className="flex flex-col gap-1.5">
      {shown.map(([cat, count]) => {
        const meta = CATEGORY_META[cat];
        const pct = Math.round((count / total) * 100);
        return (
          <div key={cat} data-cl-cat-row className="flex items-center gap-1.5">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--cl-text-muted)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0"
            >
              <path d={meta.iconPath} />
            </svg>
            <span
              className="shrink-0"
              style={{
                color: "var(--cl-text-muted)",
                fontFamily: "var(--cl-font-mono)",
                fontFeatureSettings: "normal",
                fontSize: 12,
                textTransform: "lowercase",
                minWidth: 64,
              }}
            >
              {CATEGORY_LABELS[cat]}
            </span>
            <div
              className="flex-1"
              style={{
                height: 4,
                borderRadius: 2,
                backgroundColor: "color-mix(in srgb, var(--cl-text-muted) 12%, transparent)",
              }}
            >
              <div
                style={{
                  width: `${pct}%`,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: "color-mix(in srgb, var(--cl-text-muted) 20%, transparent)",
                }}
              />
            </div>
            <span
              className="tabular-nums shrink-0"
              style={{
                color: "var(--cl-text-muted)",
                fontFamily: "var(--cl-font-mono)",
                fontFeatureSettings: "normal",
                fontSize: 12,
                minWidth: 28,
                textAlign: "right",
              }}
            >
              {pct}%
            </span>
          </div>
        );
      })}
      {overflow > 0 && (
        <div
          style={{
            color: "var(--cl-text-subdued)",
            fontFamily: "var(--cl-font-mono)",
            fontFeatureSettings: "normal",
            fontSize: 11,
            paddingLeft: 80, /* align roughly under the bars */
          }}
        >
          +{overflow} more
        </div>
      )}
    </div>
  );
}

// ── Trigger Context Parser ────────────────────────────────

function parseTriggerLabel(
  context: string | undefined,
  mode?: string,
  schedule?: string,
): string | null {
  if (context) {
    const lower = context.toLowerCase();
    if (lower.includes("cron")) return schedule ?? "via cron";
    if (lower.includes("telegram")) return "via telegram";
    if (lower.includes("api")) return "via API";
    if (lower.includes("interactive")) return null;
  }
  if (mode === "scheduled") return schedule ?? "via cron";
  return null;
}
