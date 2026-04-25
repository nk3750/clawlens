import { Link } from "react-router-dom";
import type { ActivityCategory, AgentInfo, RiskTier } from "../lib/types";
import { CATEGORY_META, relTime, riskTierFromScore } from "../lib/utils";
import { useSessionSummary } from "../hooks/useSessionSummary";
import GradientAvatar from "./GradientAvatar";
import RiskMixMicrobar from "./RiskMixMicrobar";

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

      {/* Risk-mix microbar — full-width stacked bar between identity and
          activity. Pass todayToolCalls as denominator so width stays honest
          against the footer's action count even when some entries lack a score.
          agentId powers the popover's click-through /activity?agent=...&tier=... */}
      {hasActivity && (
        <div className="mt-2">
          <RiskMixMicrobar
            mix={agent.todayRiskMix}
            total={agent.todayToolCalls}
            agentId={agent.id}
          />
        </div>
      )}

      {/* Category breakdown bars — fill tinted with the row's category color
          at 75% over a flat translucent-white track. Icon stroke + bar share
          the same hue (agent-card-polish §2). */}
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
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  color: "var(--cl-text-muted)",
                  fontFamily: "var(--cl-font-mono)",
                  fontFeatureSettings: "normal",
                  fontSize: 12,
                  fontStyle: "italic",
                }}
              >
                <SparklesIcon className="cl-ai-pulse" />
                Summarizing…
              </span>
            ) : (
              <button
                type="button"
                className="cl-ai-shine"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  fetchSummary();
                }}
                style={{
                  // backgroundColor longhand only — the `background` shorthand
                  // would reset background-image and kill the .cl-ai-shine
                  // gradient (with color: transparent that renders the text
                  // fully invisible, leaving only the SparklesIcon visible).
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  fontFamily: "var(--cl-font-mono)",
                  fontFeatureSettings: "normal",
                  fontSize: 12,
                  backgroundColor: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                <SparklesIcon />
                summarize
              </button>
            )}
          </span>
        )}
      </div>
    </Link>
  );
}

// Lucide `sparkles` — the AI-affordance icon. Stroke is set on the element
// (not via background-clip), so it renders solid even when a sibling text
// node uses background-clip: text. Caller may pass `className="cl-ai-pulse"`
// to opt-in to the loading-state pulse animation.
function SparklesIcon({ className }: { className?: string }) {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--cl-accent)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3L12 3z" />
      <path d="M19 3v4" />
      <path d="M17 5h4" />
    </svg>
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
              stroke={meta.color}
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
              {CATEGORY_META[cat].label}
            </span>
            <div
              className="flex-1"
              style={{
                height: 4,
                borderRadius: 2,
                backgroundColor: "rgba(255,255,255,0.04)",
              }}
            >
              <div
                style={{
                  width: `${pct}%`,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: `color-mix(in srgb, ${meta.color} 75%, transparent)`,
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
