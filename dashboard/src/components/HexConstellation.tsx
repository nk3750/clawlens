import { useState, useMemo } from "react";
import type { AgentInfo } from "../lib/types";
import HexField from "./HexField";
import type { HexNodeData } from "./HexField";
import HexNode from "./HexNode";
import AgentCard from "./AgentCard";

interface Props {
  agents: AgentInfo[];
}

type TooltipAnchor = "below" | "above" | "left" | "right";

interface NodePosition {
  x: number;
  y: number;
  tooltip: TooltipAnchor;
}

/**
 * Generate hex-ring positions that grow outward like a honeycomb.
 *
 * Ring 0: center (1 slot)
 * Ring 1: 6 slots at hex vertices
 * Ring 2: 12 slots (vertices + midpoints)
 * Ring 3: 18 slots, etc.
 *
 * Capacity: 1, 7, 19, 37, ...
 */
function generatePositions(count: number): NodePosition[] {
  const cx = 0.50;
  const cy = 0.47; // slightly above center for visual balance
  const positions: NodePosition[] = [];

  // Ring 0: center
  if (count >= 1) {
    positions.push({ x: cx, y: cy, tooltip: "below" });
  }

  // Ring 1: 6 hex vertices (start from top, clockwise)
  const r1 = 0.27;
  const aspectStretch = 1.15; // stretch horizontally for 3:2 aspect ratio
  for (let i = 0; i < 6 && positions.length < count; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 2;
    const x = cx + r1 * Math.cos(angle) * aspectStretch;
    const y = cy + r1 * Math.sin(angle);
    positions.push({ x, y, tooltip: anchorFromAngle(angle) });
  }

  // Ring 2: 12 positions (interleaved vertices + midpoints)
  const r2 = 0.43;
  for (let i = 0; i < 12 && positions.length < count; i++) {
    const angle = (Math.PI / 6) * i - Math.PI / 2;
    const x = cx + r2 * Math.cos(angle) * aspectStretch;
    const y = cy + r2 * Math.sin(angle);
    positions.push({ x, y, tooltip: anchorFromAngle(angle) });
  }

  return positions.slice(0, count);
}

function anchorFromAngle(angle: number): TooltipAnchor {
  // Normalize to 0-2PI
  const a = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  // Top quadrant → tooltip below, etc.
  if (a > 5 * Math.PI / 4 && a < 7 * Math.PI / 4) return "below"; // top
  if (a > Math.PI / 4 && a < 3 * Math.PI / 4) return "above"; // bottom
  if (a >= 3 * Math.PI / 4 && a <= 5 * Math.PI / 4) return "right"; // left side
  return "left"; // right side
}

export default function HexConstellation({ agents }: Props) {
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  // Sort agents: highest risk at center, then by risk descending
  const sortedAgents = useMemo(() => {
    return [...agents].sort((a, b) => {
      // Active before idle
      if (a.status !== b.status) return a.status === "active" ? -1 : 1;
      // Higher risk more prominent (center)
      return b.avgRiskScore - a.avgRiskScore;
    });
  }, [agents]);

  // Generate positions for however many agents we have
  const positions = useMemo(
    () => generatePositions(sortedAgents.length),
    [sortedAgents.length],
  );

  // Build SVG node data
  const svgNodes: HexNodeData[] = sortedAgents.map((a, i) => ({
    x: positions[i].x,
    y: positions[i].y,
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
        style={{ aspectRatio: "3 / 2", maxHeight: 720 }}
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
              position={positions[i]}
              tooltipAnchor={positions[i].tooltip}
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
