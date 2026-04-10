import { useNavigate } from "react-router-dom";
import type { InterventionEntry, RiskTier } from "../lib/types";
import { riskColorRaw } from "../lib/utils";

interface Props {
  interventions: InterventionEntry[];
  isToday: boolean;
  dateLabel?: string;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

const BADGE_COLORS: Record<string, { text: string; bg: string }> = {
  block: { text: riskColorRaw("high"), bg: `${riskColorRaw("high")}18` },
  blocked: { text: riskColorRaw("high"), bg: `${riskColorRaw("high")}18` },
  denied: { text: riskColorRaw("high"), bg: `${riskColorRaw("high")}18` },
  pending: { text: riskColorRaw("medium"), bg: `${riskColorRaw("medium")}18` },
  allow: { text: riskColorRaw("low"), bg: `${riskColorRaw("low")}18` },
  approved: { text: riskColorRaw("low"), bg: `${riskColorRaw("low")}18` },
  timeout: { text: "#9a958e", bg: "rgba(154, 149, 142, 0.1)" },
};

function badgeLabel(decision: string): string {
  switch (decision) {
    case "block":
    case "denied":
      return "BLOCKED";
    case "pending":
    case "allow": // approval_required in observe mode → shows as allow
      return "PENDING";
    case "approved":
      return "APPROVED";
    case "timeout":
      return "TIMEOUT";
    default:
      return decision.toUpperCase();
  }
}

export default function FlaggedPanel({ interventions, isToday, dateLabel }: Props) {
  const navigate = useNavigate();

  const hasItems = interventions.length > 0;
  const blockedCount = interventions.filter(
    (i) => i.effectiveDecision === "block" || i.effectiveDecision === "denied",
  ).length;

  return (
    <section style={{ marginTop: "clamp(16px, 2vw, 32px)" }}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <span
          className="text-[11px] font-semibold tracking-widest uppercase"
          style={{ color: "var(--cl-text-muted)" }}
        >
          Flagged
        </span>
        {hasItems && (
          <span
            className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
            style={{
              color: blockedCount > 0 ? riskColorRaw("high") : riskColorRaw("medium"),
              backgroundColor:
                blockedCount > 0
                  ? `${riskColorRaw("high")}18`
                  : `${riskColorRaw("medium")}18`,
            }}
          >
            {interventions.length}
          </span>
        )}
      </div>

      {/* Content */}
      {hasItems ? (
        <div className="flex flex-col gap-1">
          {interventions.map((item, idx) => {
            const tierColor = riskColorRaw(item.riskTier as RiskTier);
            const badge = BADGE_COLORS[item.effectiveDecision] ?? BADGE_COLORS.timeout;
            const isPending = item.effectiveDecision === "pending" || item.effectiveDecision === "allow";

            return (
              <button
                type="button"
                key={`${item.timestamp}-${idx}`}
                className="flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors duration-150 w-full"
                style={{
                  backgroundColor: "transparent",
                  borderLeft: `3px solid ${tierColor}`,
                  cursor: "pointer",
                  border: "none",
                  borderLeftWidth: 3,
                  borderLeftStyle: "solid",
                  borderLeftColor: tierColor,
                }}
                onClick={() => {
                  if (item.sessionKey) {
                    navigate(`/session/${encodeURIComponent(item.sessionKey)}`);
                  } else {
                    navigate(`/agent/${encodeURIComponent(item.agentId)}`);
                  }
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = "var(--cl-elevated)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "transparent";
                }}
              >
                {/* Time */}
                <span
                  className="font-mono text-[11px] shrink-0"
                  style={{ color: "var(--cl-text-muted)", width: 48 }}
                >
                  {formatTime(item.timestamp)}
                </span>

                {/* Agent */}
                <span
                  className="text-[12px] font-medium truncate shrink-0"
                  style={{ color: "var(--cl-text-primary)", maxWidth: 110 }}
                >
                  {item.agentName}
                </span>

                {/* Description */}
                <span
                  className="text-[12px] truncate flex-1 min-w-0"
                  style={{ color: "var(--cl-text-muted)" }}
                >
                  {item.description}
                </span>

                {/* Score */}
                <span
                  className="font-mono text-[11px] shrink-0 text-right"
                  style={{ color: tierColor, width: 32 }}
                >
                  {item.riskScore}
                </span>

                {/* Badge */}
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase shrink-0"
                  style={{
                    color: badge.text,
                    backgroundColor: badge.bg,
                    animation: isPending ? "pulse 2s ease-in-out infinite" : undefined,
                  }}
                >
                  {badgeLabel(item.effectiveDecision)}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex items-center justify-center py-8 gap-2">
          <span style={{ color: "var(--cl-risk-low)", fontSize: 16 }}>&#10003;</span>
          <span
            className="text-sm italic"
            style={{ color: "var(--cl-text-muted)" }}
          >
            {isToday
              ? "All clear \u2014 fleet operating autonomously"
              : `All clear \u2014 nothing flagged on ${dateLabel ?? "this day"}`}
          </span>
        </div>
      )}
    </section>
  );
}
