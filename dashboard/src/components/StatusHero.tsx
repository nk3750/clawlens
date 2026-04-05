import type { StatsResponse, EntryResponse } from "../lib/types";

type Status = "ok" | "warning" | "critical";

function deriveStatus(
  stats: StatsResponse | null,
  entries: EntryResponse[] | null,
): { status: Status; headline: string; subtitle: string } {
  if (!stats || !entries) {
    return { status: "ok", headline: "Listening\u2026", subtitle: "Waiting for agent activity" };
  }

  const blockedRecent = entries.filter(
    (e) => e.effectiveDecision === "block" || e.effectiveDecision === "denied",
  ).length;
  const pending = stats.pending || 0;
  const criticalRisk = entries.filter(
    (e) => e.riskTier === "critical",
  ).length;

  if (criticalRisk > 0 || blockedRecent > 3) {
    return {
      status: "critical",
      headline: "Needs Attention",
      subtitle: criticalRisk > 0
        ? `${criticalRisk} critical-risk action${criticalRisk !== 1 ? "s" : ""} detected`
        : `${blockedRecent} actions blocked recently`,
    };
  }

  if (pending > 0) {
    return {
      status: "warning",
      headline: "Awaiting Approval",
      subtitle: `${pending} action${pending !== 1 ? "s" : ""} waiting for your decision`,
    };
  }

  return {
    status: "ok",
    headline: "All Clear",
    subtitle: "Your agents are running smoothly",
  };
}

const statusConfig = {
  ok: {
    color: "#34d399",
    bgClass: "bg-status-active/8",
    glowClass: "shadow-[0_0_40px_-10px_rgba(52,211,153,0.3)]",
    icon: (
      <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 13l4 4L19 7" />
      </svg>
    ),
  },
  warning: {
    color: "#fbbf24",
    bgClass: "bg-risk-medium/8",
    glowClass: "shadow-[0_0_40px_-10px_rgba(251,191,36,0.3)]",
    icon: (
      <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <path d="M12 9v4" />
        <circle cx="12" cy="16" r="0.5" fill="currentColor" />
      </svg>
    ),
  },
  critical: {
    color: "#f87171",
    bgClass: "bg-risk-high/8",
    glowClass: "shadow-[0_0_40px_-10px_rgba(248,113,113,0.3)]",
    icon: (
      <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <path d="M12 9v4" />
        <circle cx="12" cy="16" r="0.5" fill="currentColor" />
      </svg>
    ),
  },
};

export default function StatusHero({
  stats,
  entries,
  agentCount,
  activeCount,
}: {
  stats: StatsResponse | null;
  entries: EntryResponse[] | null;
  agentCount: number;
  activeCount: number;
}) {
  const { status, headline, subtitle } = deriveStatus(stats, entries);
  const config = statusConfig[status];

  return (
    <div className="text-center py-10 mb-6 animate-fade-in">
      {/* Status ring */}
      <div
        className={`w-20 h-20 rounded-full mx-auto mb-5 flex items-center justify-center ${config.bgClass} ${config.glowClass} transition-all duration-700`}
        style={{ color: config.color }}
      >
        {config.icon}
      </div>

      {/* Headline */}
      <h1 className="font-display font-bold text-primary text-2xl mb-1 tracking-tight">
        {headline}
      </h1>
      <p className="text-sm text-muted mb-4">{subtitle}</p>

      {/* Quick context */}
      <div className="flex items-center justify-center gap-3 text-xs text-muted">
        <span>
          <span className="text-secondary">{agentCount}</span> agent{agentCount !== 1 ? "s" : ""}
        </span>
        <span className="text-border">{"\u00b7"}</span>
        {activeCount > 0 ? (
          <span className="text-status-active">
            {activeCount} active
          </span>
        ) : (
          <span>all idle</span>
        )}
        {stats && (
          <>
            <span className="text-border">{"\u00b7"}</span>
            <span>
              <span className="text-secondary">{stats.total}</span> actions today
            </span>
          </>
        )}
      </div>
    </div>
  );
}
