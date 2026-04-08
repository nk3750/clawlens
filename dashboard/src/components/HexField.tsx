import { useMemo } from "react";
import type { Edge } from "./HexConstellation";

export interface HexNodeData {
  x: number;
  y: number;
  id: string;
  riskScore: number;
  riskPosture: "calm" | "elevated" | "high" | "critical";
  status: "active" | "idle";
  context?: string;
}

interface Props {
  nodes: HexNodeData[];
  edges: Edge[];
  hoveredNodeId: string | null;
  agentCount: number;
  width?: number;
  height?: number;
}

const RISK_COLORS: Record<string, string> = {
  calm: "#4ade80",
  elevated: "#fbbf24",
  high: "#f87171",
  critical: "#ef4444",
};

const GLOW_RADIUS: Record<string, number> = {
  calm: 8,
  elevated: 12,
  high: 16,
  critical: 22,
};

export default function HexField({
  nodes, edges, hoveredNodeId, agentCount, width = 1200, height = 800,
}: Props) {
  const cx = width / 2;
  const cy = height * 0.48;

  // Deterministic particles
  const particles = useMemo(() => {
    const pts: Array<{ x: number; y: number; r: number; o: number }> = [];
    let seed = 42;
    const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    for (let i = 0; i < 200; i++) {
      const angle = rand() * Math.PI * 2;
      const dist = rand() * 500 + 15;
      pts.push({ x: cx + Math.cos(angle) * dist, y: cy + Math.sin(angle) * dist, r: rand() * 1.3 + 0.1, o: rand() * 0.16 + 0.02 });
    }
    return pts;
  }, [cx, cy]);

  // Hovered node's edge set
  const hoveredEdgeSet = useMemo(() => {
    if (!hoveredNodeId) return new Set<string>();
    const hi = nodes.findIndex((n) => n.id === hoveredNodeId);
    if (hi === -1) return new Set<string>();
    const set = new Set<string>();
    for (const e of edges) {
      if (e.from === hi || e.to === hi) set.add(`${e.from}-${e.to}`);
    }
    return set;
  }, [hoveredNodeId, nodes, edges]);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-full"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        {/* Radial vignette */}
        <radialGradient id="hex-fade">
          <stop offset="0%" stopColor="white" stopOpacity="1" />
          <stop offset="55%" stopColor="white" stopOpacity="0.95" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </radialGradient>
        <mask id="hex-mask">
          <rect width={width} height={height} fill="url(#hex-fade)" />
        </mask>

        {/* Per-node glow filters */}
        {nodes.map((n) => {
          const color = RISK_COLORS[n.riskPosture];
          const isHov = hoveredNodeId === n.id;
          const blur = GLOW_RADIUS[n.riskPosture] * (isHov ? 1.6 : 1);
          return (
            <filter key={n.id} id={`glow-${n.id}`} x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur stdDeviation={blur} result="blur" />
              <feFlood floodColor={color} floodOpacity={isHov ? 0.5 : 0.25} result="color" />
              <feComposite in="color" in2="blur" operator="in" result="glow" />
              <feMerge>
                <feMergeNode in="glow" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          );
        })}
      </defs>

      <g mask="url(#hex-mask)">
        {/* ── Ambient particles ── */}
        {particles.map((p, i) => (
          <circle
            key={i} cx={p.x} cy={p.y} r={p.r}
            fill="#d4a574"
            className="particle-fade"
            style={{ "--particle-opacity": p.o } as React.CSSProperties}
          />
        ))}

        {/* ── Edges — Obsidian-style: visible, warm gray, fluid ── */}
        {edges.map((edge) => {
          const a = nodes[edge.from];
          const b = nodes[edge.to];
          if (!a || !b) return null;
          const key = `${edge.from}-${edge.to}`;
          const isHighlit = hoveredEdgeSet.has(key);
          const isDimmed = hoveredNodeId !== null && !isHighlit;

          // Blend risk colors for edge
          const cA = RISK_COLORS[a.riskPosture];
          const cB = RISK_COLORS[b.riskPosture];
          // Use the higher-risk node's color for the edge tint
          const edgeColor = a.riskScore >= b.riskScore ? cA : cB;

          return (
            <line
              key={`edge-${key}`}
              x1={a.x * width} y1={a.y * height}
              x2={b.x * width} y2={b.y * height}
              stroke={edgeColor}
              strokeWidth={isHighlit ? 1.8 : 1}
              strokeLinecap="round"
              className={isHighlit || isDimmed ? "" : "conn-fade"}
              opacity={isHighlit ? 0.5 : isDimmed ? 0.05 : undefined}
              style={{
                "--conn-opacity": 0.2,
                transition: "opacity 0.35s ease, stroke-width 0.35s ease, stroke 0.35s ease",
              } as React.CSSProperties}
            />
          );
        })}

        {/* ── Node glows ── */}
        {nodes.map((n) => {
          const px = n.x * width;
          const py = n.y * height;
          const color = RISK_COLORS[n.riskPosture];
          const isHov = hoveredNodeId === n.id;
          const isActive = n.status === "active";

          // Scale glow size with agent count
          const baseR = agentCount > 12 ? 22 : 28;
          const hovR = agentCount > 12 ? 28 : 35;
          const rest = isHov ? 0.45 : 0.18;

          return (
            <g key={n.id}>
              <circle
                cx={px} cy={py} r={isHov ? hovR : baseR}
                fill="none" stroke={color} strokeWidth="1"
                filter={`url(#glow-${n.id})`}
                className={isHov ? "" : "node-glow-enter"}
                opacity={isHov ? 0.45 : undefined}
                style={{ "--glow-resting": rest, transition: "r 0.5s ease, opacity 0.4s ease" } as React.CSSProperties}
              />
              <circle
                cx={px} cy={py} r={isHov ? 5 : 3} fill={color}
                className="node-glow-enter"
                style={{ "--glow-resting": isActive ? 0.6 : 0.3, transition: "r 0.3s ease" } as React.CSSProperties}
              >
                {isActive && (
                  <animate attributeName="opacity" values="0.6;0.2;0.6" dur="2s" repeatCount="indefinite" />
                )}
              </circle>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
