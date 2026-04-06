/**
 * HexField — SVG hexagonal grid background with connecting lines.
 * Creates the constellation/network visual behind agent cards.
 * Inspired by Hex.tech "Data Manager" visualization.
 */

interface Props {
  /** Agent positions (normalized 0-1) for drawing connection lines */
  nodes?: Array<{ x: number; y: number }>;
  width?: number;
  height?: number;
}

export default function HexField({ nodes = [], width = 1200, height = 700 }: Props) {
  const cx = width / 2;
  const cy = height / 2;

  // Generate hex vertices at a given center and radius
  function hexPoints(ox: number, oy: number, r: number): string {
    return Array.from({ length: 6 }, (_, i) => {
      const angle = (Math.PI / 3) * i - Math.PI / 6;
      return `${ox + r * Math.cos(angle)},${oy + r * Math.sin(angle)}`;
    }).join(" ");
  }

  // Scatter dots inside the hex area
  const dots: Array<{ x: number; y: number; r: number; o: number }> = [];
  for (let i = 0; i < 60; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * 280;
    dots.push({
      x: cx + Math.cos(angle) * dist,
      y: cy + Math.sin(angle) * dist,
      r: Math.random() * 1.5 + 0.5,
      o: Math.random() * 0.25 + 0.05,
    });
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ opacity: 0.6 }}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <linearGradient id="hex-stroke" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#d4a574" stopOpacity="0.08" />
          <stop offset="50%" stopColor="#a78bfa" stopOpacity="0.06" />
          <stop offset="100%" stopColor="#d4a574" stopOpacity="0.04" />
        </linearGradient>
        <radialGradient id="hex-fade">
          <stop offset="0%" stopColor="white" stopOpacity="1" />
          <stop offset="70%" stopColor="white" stopOpacity="0.8" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </radialGradient>
        <mask id="hex-mask">
          <rect width={width} height={height} fill="url(#hex-fade)" />
        </mask>
      </defs>

      <g mask="url(#hex-mask)">
        {/* Concentric hexagonal wireframes */}
        {[320, 240, 160, 80].map((r, i) => (
          <polygon
            key={r}
            points={hexPoints(cx, cy, r)}
            fill="none"
            stroke="url(#hex-stroke)"
            strokeWidth={i === 0 ? 1 : 0.5}
            strokeDasharray={i > 1 ? "4 8" : "none"}
          />
        ))}

        {/* Cross lines through hex center */}
        {[0, 60, 120].map((deg) => {
          const rad = (deg * Math.PI) / 180 - Math.PI / 6;
          const r = 320;
          return (
            <line
              key={deg}
              x1={cx + r * Math.cos(rad)}
              y1={cy + r * Math.sin(rad)}
              x2={cx - r * Math.cos(rad)}
              y2={cy - r * Math.sin(rad)}
              stroke="url(#hex-stroke)"
              strokeWidth="0.5"
              strokeDasharray="2 6"
            />
          );
        })}

        {/* Scattered particles */}
        {dots.map((d, i) => (
          <circle
            key={i}
            cx={d.x}
            cy={d.y}
            r={d.r}
            fill="#d4a574"
            opacity={d.o}
          />
        ))}

        {/* Connection lines between agent nodes */}
        {nodes.length > 1 &&
          nodes.map((a, i) =>
            nodes.slice(i + 1).map((b, j) => (
              <line
                key={`${i}-${j}`}
                x1={a.x * width}
                y1={a.y * height}
                x2={b.x * width}
                y2={b.y * height}
                stroke="#d4a574"
                strokeWidth="0.5"
                strokeOpacity="0.1"
                strokeDasharray="3 6"
              />
            )),
          )}

        {/* Glowing dots at node positions */}
        {nodes.map((n, i) => (
          <g key={i}>
            <circle
              cx={n.x * width}
              cy={n.y * height}
              r="4"
              fill="#d4a574"
              opacity="0.15"
            />
            <circle
              cx={n.x * width}
              cy={n.y * height}
              r="2"
              fill="#d4a574"
              opacity="0.3"
            />
          </g>
        ))}
      </g>
    </svg>
  );
}
