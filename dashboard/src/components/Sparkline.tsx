import type { RiskTrendPoint } from "../lib/types";
import { riskTierFromScore, riskColorRaw } from "../lib/utils";

interface Props {
  points: RiskTrendPoint[];
  width?: number;
  height?: number;
}

export default function Sparkline({ points, width = 320, height = 100 }: Props) {
  if (points.length === 0) {
    return (
      <div
        className="flex items-center justify-center label-mono"
        style={{ width, height, color: "var(--cl-text-muted)" }}
      >
        No trend data
      </div>
    );
  }

  const pad = { top: 8, right: 12, bottom: 24, left: 32 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const timestamps = points.map((p) => new Date(p.timestamp).getTime());
  const minT = Math.min(...timestamps);
  const maxT = Math.max(...timestamps);
  const spanT = maxT - minT || 1;

  const x = (t: number) => pad.left + ((t - minT) / spanT) * plotW;
  const y = (s: number) => pad.top + plotH - (Math.min(s, 100) / 100) * plotH;

  // Time axis labels: start, mid, end
  const fmtTime = (ms: number) => {
    const d = new Date(ms);
    const h = d.getHours();
    const m = d.getMinutes();
    const ampm = h >= 12 ? "pm" : "am";
    const h12 = h % 12 || 12;
    return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, "0")}${ampm}`;
  };

  const timeLabels = [
    { t: minT, label: fmtTime(minT) },
    { t: minT + spanT / 2, label: fmtTime(minT + spanT / 2) },
    { t: maxT, label: "now" },
  ];

  // Y-axis labels
  const yLabels = [0, 50, 100];

  // Line path connecting points chronologically
  const linePath = points
    .map((p, i) => {
      const px = x(new Date(p.timestamp).getTime());
      const py = y(p.score);
      return `${i === 0 ? "M" : "L"} ${px} ${py}`;
    })
    .join(" ");

  // Gradient area fill
  const areaPath =
    linePath +
    ` L ${x(timestamps[timestamps.length - 1])} ${pad.top + plotH}` +
    ` L ${x(timestamps[0])} ${pad.top + plotH} Z`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible"
    >
      <defs>
        <filter id="sparkle-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <linearGradient id="area-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--cl-accent)" stopOpacity="0.08" />
          <stop offset="100%" stopColor="var(--cl-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Grid lines */}
      {yLabels.map((v) => (
        <line
          key={v}
          x1={pad.left}
          y1={y(v)}
          x2={width - pad.right}
          y2={y(v)}
          stroke="var(--cl-border-subtle)"
          strokeDasharray="3 3"
        />
      ))}

      {/* Area fill */}
      <path d={areaPath} fill="url(#area-fill)" />

      {/* Line */}
      <path
        d={linePath}
        fill="none"
        stroke="var(--cl-accent)"
        strokeWidth="1.5"
        strokeOpacity="0.4"
        strokeLinejoin="round"
      />

      {/* Dots */}
      {points.map((p, i) => {
        const tier = riskTierFromScore(p.score);
        const color = riskColorRaw(tier);
        const px = x(new Date(p.timestamp).getTime());
        const py = y(p.score);
        return (
          <circle
            key={i}
            cx={px}
            cy={py}
            r={3}
            fill={color}
            filter={p.score > 25 ? "url(#sparkle-glow)" : undefined}
          >
            <title>{`${p.toolName}: ${p.score}`}</title>
          </circle>
        );
      })}

      {/* Y-axis labels */}
      {yLabels.map((v) => (
        <text
          key={v}
          x={pad.left - 6}
          y={y(v)}
          textAnchor="end"
          dominantBaseline="central"
          className="label-mono"
          style={{ fill: "var(--cl-text-muted)", fontSize: 9 }}
        >
          {v}
        </text>
      ))}

      {/* X-axis labels */}
      {timeLabels.map((tl, i) => (
        <text
          key={i}
          x={x(tl.t)}
          y={height - 4}
          textAnchor="middle"
          className="label-mono"
          style={{ fill: "var(--cl-text-muted)", fontSize: 9 }}
        >
          {tl.label}
        </text>
      ))}
    </svg>
  );
}
