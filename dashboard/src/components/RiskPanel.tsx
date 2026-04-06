import type { AgentInfo, RiskTrendPoint } from "../lib/types";
import RiskArc from "./RiskArc";
import Sparkline from "./Sparkline";

interface Props {
  agent: AgentInfo;
  riskTrend: RiskTrendPoint[];
  /** All agents for fleet rank computation */
  allAgents?: AgentInfo[];
  /** Current session stats */
  sessionStats?: {
    avg: number;
    peak: number;
    count: number;
  };
}

export default function RiskPanel({ agent, riskTrend, allAgents, sessionStats }: Props) {
  // Fleet rank: sort all agents by avgRiskScore descending, find this agent's position
  let fleetRank: string | null = null;
  if (allAgents && allAgents.length > 1) {
    const sorted = [...allAgents].sort((a, b) => b.avgRiskScore - a.avgRiskScore);
    const idx = sorted.findIndex((a) => a.id === agent.id);
    if (idx >= 0) {
      fleetRank = `${idx + 1} of ${sorted.length}`;
    }
  }

  const avg = sessionStats?.avg ?? agent.avgRiskScore;
  const peak = sessionStats?.peak ?? agent.peakRiskScore;

  return (
    <div>
      {/* Large RiskArc */}
      <div className="flex justify-center mb-6">
        <RiskArc score={avg} size={140} />
      </div>

      {/* Session stats */}
      <div className="flex flex-wrap gap-x-6 gap-y-2 mb-6 justify-center">
        <div>
          <span className="label-mono" style={{ color: "var(--cl-text-muted)" }}>session avg</span>
          <span className="label-mono ml-2" style={{ color: "var(--cl-text-secondary)" }}>{avg}</span>
        </div>
        <div>
          <span className="label-mono" style={{ color: "var(--cl-text-muted)" }}>peak</span>
          <span className="label-mono ml-2" style={{ color: "var(--cl-text-secondary)" }}>{peak}</span>
        </div>
        {fleetRank && (
          <div>
            <span className="label-mono" style={{ color: "var(--cl-text-muted)" }}>fleet rank</span>
            <span className="label-mono ml-2" style={{ color: "var(--cl-text-secondary)" }}>{fleetRank}</span>
          </div>
        )}
      </div>

      {/* 24h risk trend sparkline */}
      <div>
        <h3 className="label-mono mb-3" style={{ color: "var(--cl-text-muted)" }}>
          24H RISK TREND
        </h3>
        <Sparkline points={riskTrend} width={320} height={100} />
      </div>
    </div>
  );
}
