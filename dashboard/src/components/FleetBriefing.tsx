import type { AgentInfo, StatsResponse } from "../lib/types";

interface Props {
  stats: StatsResponse;
  agents: AgentInfo[];
  isToday: boolean;
  dateLabel?: string; // e.g., "Apr 6" for past days
}

const POSTURE_COLOR: Record<string, string> = {
  calm: "var(--cl-risk-low)",
  elevated: "var(--cl-risk-medium)",
  high: "var(--cl-risk-high)",
  critical: "var(--cl-risk-critical)",
};

function generateBriefing(
  stats: StatsResponse,
  agents: AgentInfo[],
  isToday: boolean,
  dateLabel?: string,
): Array<{ text: string; color?: string; bold?: boolean }> {
  const segments: Array<{ text: string; color?: string; bold?: boolean }> = [];
  const activeCount = agents.filter((a) => a.status === "active").length;
  const totalCount = agents.length;
  const postureColor = POSTURE_COLOR[stats.riskPosture] ?? POSTURE_COLOR.calm;

  // Segment 1: active agents + posture
  if (isToday) {
    if (activeCount > 0) {
      segments.push({ text: `${activeCount} of ${totalCount} agents active, fleet risk ` });
    } else {
      segments.push({ text: `All ${totalCount} agents idle, fleet risk ` });
    }
  } else {
    segments.push({
      text: `${totalCount} agents were active on ${dateLabel ?? "that day"}, fleet risk `,
    });
  }
  segments.push({ text: stats.riskPosture, color: postureColor, bold: true });
  segments.push({ text: ". " });

  // Segment 2: action count + autonomy
  const autonomy =
    stats.total > 0 ? Math.round((stats.allowed / stats.total) * 100) : 100;
  segments.push({
    text: `${stats.total} actions, ${autonomy}% autonomous. `,
  });

  // Segment 3: attention callouts
  const attentionAgents = agents.filter((a) => a.needsAttention);
  for (const agent of attentionAgents) {
    segments.push({
      text: agent.name,
      bold: true,
      color: "var(--cl-text-primary)",
    });
    segments.push({ text: ` ${agent.attentionReason ?? "needs attention"}. ` });
  }

  return segments;
}

export default function FleetBriefing({ stats, agents, isToday, dateLabel }: Props) {
  if (stats.total === 0 && agents.length === 0) return null;

  const segments = generateBriefing(stats, agents, isToday, dateLabel);

  return (
    <div
      className="rounded-lg mx-auto max-w-2xl"
      style={{
        backgroundColor: "var(--cl-surface)",
        padding: "16px 20px",
      }}
    >
      <p className="text-sm leading-relaxed" style={{ color: "var(--cl-text-muted)" }}>
        {segments.map((seg, i) => (
          <span
            key={i}
            style={{
              color: seg.color,
              fontWeight: seg.bold ? 500 : undefined,
            }}
          >
            {seg.text}
          </span>
        ))}
      </p>
    </div>
  );
}
