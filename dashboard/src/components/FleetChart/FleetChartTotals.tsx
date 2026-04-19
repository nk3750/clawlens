import { Link } from "react-router-dom";
import type { AgentInfo, RiskTier, TimelineSession } from "../../lib/types";
import { riskColorRaw, riskTierFromScore } from "../../lib/utils";
import { TOTALS_WIDTH, TOTALS_WIDTH_MOBILE } from "./utils";

interface Props {
  agent: AgentInfo;
  sessions: TimelineSession[];
  isToday: boolean;
  mobile: boolean;
}

function tierShort(tier: RiskTier): string {
  switch (tier) {
    case "critical":
      return "crit";
    case "high":
      return "high";
    case "medium":
      return "med";
    case "low":
      return "low";
  }
}

export default function FleetChartTotals({
  agent,
  sessions,
  isToday,
  mobile,
}: Props) {
  const summedActions = sessions.reduce((acc, s) => acc + s.actionCount, 0);
  const actionCount = isToday
    ? Math.max(agent.todayToolCalls, summedActions)
    : summedActions;
  const maxPeak = sessions.reduce((m, s) => Math.max(m, s.peakRisk), 0);
  const tier = riskTierFromScore(maxPeak);
  const tierColor = riskColorRaw(tier);
  const blocked = sessions.reduce((a, s) => a + s.blockedCount, 0);

  const width = mobile ? TOTALS_WIDTH_MOBILE : TOTALS_WIDTH;
  const isEmpty = actionCount === 0;

  return (
    <Link
      to={`/agent/${encodeURIComponent(agent.id)}`}
      className="shrink-0 flex flex-col justify-center gap-0.5 no-underline pl-2"
      style={{ width, color: "var(--cl-text-primary)", textDecoration: "none" }}
      data-cl-fleet-totals
    >
      <span
        className="font-mono tabular-nums font-semibold"
        style={{
          fontSize: 14,
          color: isEmpty ? "var(--cl-text-muted)" : "var(--cl-text-primary)",
          lineHeight: 1.1,
        }}
      >
        {isEmpty ? "0" : actionCount}
        {!mobile && (
          <span
            className="font-sans font-normal ml-1"
            style={{ fontSize: 10, color: "var(--cl-text-muted)" }}
          >
            {actionCount === 1 ? "action" : "actions"}
          </span>
        )}
      </span>
      {!isEmpty && (
        <span
          className="flex items-center gap-1 label-mono"
          style={{ fontSize: 10 }}
          data-cl-fleet-risk-pill
        >
          <span
            className="inline-block rounded-full"
            style={{ width: 6, height: 6, backgroundColor: tierColor }}
          />
          <span style={{ color: tierColor }}>{tierShort(tier)}</span>
        </span>
      )}
      {blocked > 0 && (
        <span
          className="label-mono"
          style={{ fontSize: 10, color: "var(--cl-risk-high)" }}
          data-cl-fleet-blocked-count
        >
          ⛔ {blocked}
        </span>
      )}
    </Link>
  );
}
