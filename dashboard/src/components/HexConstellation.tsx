import { useState, useMemo } from "react";
import type { AgentInfo } from "../lib/types";
import HexField from "./HexField";
import type { HexNodeData } from "./HexField";
import HexNode from "./HexNode";
import AgentCard from "./AgentCard";

interface Props {
  agents: AgentInfo[];
}

// Diamond layout: top, right, bottom, left (hex vertex positions)
const POSITIONS: Array<{ x: number; y: number; tooltip: "below" | "above" | "right" | "left" }> = [
  { x: 0.50, y: 0.14, tooltip: "below" },  // top center
  { x: 0.82, y: 0.48, tooltip: "left" },    // right
  { x: 0.50, y: 0.82, tooltip: "above" },   // bottom center
  { x: 0.18, y: 0.48, tooltip: "right" },   // left
];

export default function HexConstellation({ agents }: Props) {
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  // Map agents to node positions — active agents get prominent positions (top, bottom)
  const sortedAgents = useMemo(() => {
    const active = agents.filter((a) => a.status === "active");
    const idle = agents.filter((a) => a.status !== "active");
    // Active at top + bottom, idle at sides
    const result: AgentInfo[] = [];
    if (active[0]) result.push(active[0]);
    if (idle[0]) result.push(idle[0]);
    if (active[1]) result.push(active[1]);
    else if (idle[1]) result.push(idle[1]);
    if (idle[active.length > 1 ? 1 : 2] ?? agents[3]) result.push(agents.find(a => !result.includes(a))!);
    // Fill remaining
    for (const a of agents) {
      if (!result.includes(a) && result.length < 4) result.push(a);
    }
    return result.slice(0, POSITIONS.length);
  }, [agents]);

  // Build SVG node data
  const svgNodes: HexNodeData[] = sortedAgents.map((a, i) => ({
    x: POSITIONS[i].x,
    y: POSITIONS[i].y,
    id: a.id,
    riskScore: a.avgRiskScore,
    riskPosture: a.riskPosture,
    status: a.status,
    context: a.currentContext,
  }));

  return (
    <>
      {/* ── Desktop: Hex constellation ── */}
      <div
        className="hidden md:block relative"
        style={{ aspectRatio: "3 / 2", maxHeight: 700 }}
      >
        {/* SVG layer */}
        <div className="absolute inset-0" style={{ zIndex: 0 }}>
          <HexField nodes={svgNodes} hoveredNodeId={hoveredNodeId} />
        </div>

        {/* HTML node layer */}
        <div className="absolute inset-0" style={{ zIndex: 1 }}>
          {sortedAgents.map((agent, i) => (
            <HexNode
              key={agent.id}
              agent={agent}
              position={POSITIONS[i]}
              tooltipAnchor={POSITIONS[i].tooltip}
              onHover={setHoveredNodeId}
            />
          ))}
        </div>
      </div>

      {/* ── Mobile: Compact card list ── */}
      <div className="md:hidden space-y-4 stagger">
        {agents.map((a) => (
          <AgentCard key={a.id} agent={a} />
        ))}
      </div>
    </>
  );
}
