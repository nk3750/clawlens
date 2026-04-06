import { useMemo } from "react";

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
  hoveredNodeId: string | null;
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

export default function HexField({ nodes, hoveredNodeId, width = 1200, height = 800 }: Props) {
  const cx = width / 2;
  const cy = height / 2;

  // Hex vertex generator (flat-top orientation)
  function hexPoints(ox: number, oy: number, r: number): string {
    return Array.from({ length: 6 }, (_, i) => {
      const angle = (Math.PI / 3) * i - Math.PI / 6;
      return `${ox + r * Math.cos(angle)},${oy + r * Math.sin(angle)}`;
    }).join(" ");
  }

  function hexVertex(ox: number, oy: number, r: number, i: number): [number, number] {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    return [ox + r * Math.cos(angle), oy + r * Math.sin(angle)];
  }

  // Deterministic particles (stable across re-renders)
  const particles = useMemo(() => {
    const pts: Array<{ x: number; y: number; r: number; o: number }> = [];
    let seed = 42;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    for (let i = 0; i < 55; i++) {
      const angle = rand() * Math.PI * 2;
      const dist = rand() * 300 + 20;
      pts.push({
        x: cx + Math.cos(angle) * dist,
        y: cy + Math.sin(angle) * dist,
        r: rand() * 1.8 + 0.3,
        o: rand() * 0.2 + 0.04,
      });
    }
    return pts;
  }, [cx, cy]);

  // Floating labels at hex edges
  const labels = useMemo(() => {
    const result: Array<{ x: number; y: number; text: string }> = [];
    nodes.forEach((n) => {
      if (n.context) {
        const labelX = n.x * width + (n.x < 0.5 ? -70 : 70);
        const labelY = n.y * height + (n.y < 0.5 ? -30 : 30);
        result.push({ x: labelX, y: labelY, text: n.context });
      }
    });
    result.push({ x: cx, y: cy + 8, text: "OBSERVATORY" });
    return result;
  }, [nodes, width, height, cx, cy]);

  const hexRadii = [340, 250, 160, 75];

  // Compute perimeters for stroke-dasharray draw-in
  const hexPerimeters = hexRadii.map((r) => {
    // Regular hexagon perimeter = 6 * side, side = r
    return 6 * r;
  });

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-full"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        {/* Radial fade mask */}
        <radialGradient id="hex-fade">
          <stop offset="0%" stopColor="white" stopOpacity="1" />
          <stop offset="60%" stopColor="white" stopOpacity="0.9" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </radialGradient>
        <mask id="hex-mask">
          <rect width={width} height={height} fill="url(#hex-fade)" />
        </mask>

        {/* Stroke gradients */}
        <linearGradient id="hex-stroke-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#d4a574" stopOpacity="0.12" />
          <stop offset="50%" stopColor="#a78bfa" stopOpacity="0.08" />
          <stop offset="100%" stopColor="#d4a574" stopOpacity="0.06" />
        </linearGradient>

        {/* Per-node glow filters */}
        {nodes.map((n) => {
          const color = RISK_COLORS[n.riskPosture];
          const isHovered = hoveredNodeId === n.id;
          const blur = GLOW_RADIUS[n.riskPosture] * (isHovered ? 1.6 : 1);
          return (
            <filter key={n.id} id={`glow-${n.id}`} x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur stdDeviation={blur} result="blur" />
              <feFlood floodColor={color} floodOpacity={isHovered ? 0.5 : 0.25} result="color" />
              <feComposite in="color" in2="blur" operator="in" result="glow" />
              <feMerge>
                <feMergeNode in="glow" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          );
        })}

        {/* Connection line gradient between two nodes */}
        {nodes.map((a, i) =>
          nodes.slice(i + 1).map((b, j) => (
            <linearGradient
              key={`grad-${i}-${j}`}
              id={`conn-${i}-${j}`}
              x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            >
              <stop offset="0%" stopColor={RISK_COLORS[a.riskPosture]} stopOpacity="0.25" />
              <stop offset="100%" stopColor={RISK_COLORS[b.riskPosture]} stopOpacity="0.25" />
            </linearGradient>
          )),
        )}
      </defs>

      <g mask="url(#hex-mask)">
        {/* ── Concentric hex wireframes (draw-in animation) ── */}
        {hexRadii.map((r, i) => (
          <polygon
            key={r}
            points={hexPoints(cx, cy, r)}
            fill="none"
            stroke="url(#hex-stroke-grad)"
            strokeWidth={i === 0 ? 1 : 0.5}
            className="hex-draw-in"
            style={{
              strokeDasharray: hexPerimeters[i],
              strokeDashoffset: hexPerimeters[i],
              animationDelay: `${(3 - i) * 0.15}s`,
              opacity: i === 0 ? 0.8 : 0.5,
            }}
          />
        ))}

        {/* ── Cross lines through hex center ── */}
        {[0, 60, 120].map((deg) => {
          const [x1, y1] = hexVertex(cx, cy, hexRadii[0], deg / 60);
          const [x2, y2] = hexVertex(cx, cy, hexRadii[0], deg / 60 + 3);
          return (
            <line
              key={deg}
              x1={x1} y1={y1} x2={x2} y2={y2}
              stroke="url(#hex-stroke-grad)"
              strokeWidth="0.5"
              strokeDasharray="3 8"
              className="particle-fade"
              style={{ "--particle-opacity": 0.4 } as React.CSSProperties}
            />
          );
        })}

        {/* ── Scattered particles (fade-in delayed) ── */}
        {particles.map((p, i) => (
          <circle
            key={i}
            cx={p.x} cy={p.y} r={p.r}
            fill="#d4a574"
            className="particle-fade"
            style={{ "--particle-opacity": p.o } as React.CSSProperties}
          />
        ))}

        {/* ── Connection lines between nodes (fade-in delayed) ── */}
        {nodes.map((a, i) =>
          nodes.slice(i + 1).map((b, j) => {
            const isHighlit =
              hoveredNodeId === a.id || hoveredNodeId === b.id;
            const restingOpacity = 0.15;
            return (
              <line
                key={`conn-${i}-${j}`}
                x1={a.x * width} y1={a.y * height}
                x2={b.x * width} y2={b.y * height}
                stroke={`url(#conn-${i}-${j})`}
                strokeWidth={isHighlit ? 1 : 0.5}
                strokeDasharray="4 8"
                className={isHighlit ? "" : "conn-fade"}
                opacity={isHighlit ? 0.6 : undefined}
                style={{
                  "--conn-opacity": restingOpacity,
                  transition: "opacity 0.4s ease, stroke-width 0.4s ease",
                } as React.CSSProperties}
              />
            );
          }),
        )}

        {/* ── Node glow circles (pulse bright then settle) ── */}
        {nodes.map((n) => {
          const px = n.x * width;
          const py = n.y * height;
          const color = RISK_COLORS[n.riskPosture];
          const isHovered = hoveredNodeId === n.id;
          const isActive = n.status === "active";
          const glowResting = isHovered ? 0.4 : 0.15;

          return (
            <g key={n.id}>
              {/* Outer glow ring */}
              <circle
                cx={px} cy={py}
                r={isHovered ? 35 : 28}
                fill="none"
                stroke={color}
                strokeWidth="1"
                filter={`url(#glow-${n.id})`}
                className={isHovered ? "" : "node-glow-enter"}
                opacity={isHovered ? 0.4 : undefined}
                style={{
                  "--glow-resting": glowResting,
                  transition: "r 0.5s ease, opacity 0.4s ease",
                } as React.CSSProperties}
              />
              {/* Inner glow dot */}
              <circle
                cx={px} cy={py}
                r={isHovered ? 6 : 4}
                fill={color}
                className="node-glow-enter"
                style={{
                  "--glow-resting": isActive ? 0.6 : 0.3,
                  transition: "r 0.3s ease, opacity 0.3s ease",
                } as React.CSSProperties}
              >
                {isActive && (
                  <animate
                    attributeName="opacity"
                    values="0.6;0.2;0.6"
                    dur="2s"
                    repeatCount="indefinite"
                  />
                )}
              </circle>
            </g>
          );
        })}

        {/* ── Floating labels ── */}
        {labels.map((l, i) => (
          <text
            key={i}
            x={l.x} y={l.y}
            textAnchor="middle"
            fill="var(--cl-text-muted)"
            className="particle-fade"
            style={{ "--particle-opacity": 0.35 } as React.CSSProperties}
            fontSize="9"
            fontFamily="'JetBrains Mono', monospace"
            letterSpacing="0.1em"
          >
            {l.text.toUpperCase()}
          </text>
        ))}
      </g>
    </svg>
  );
}
