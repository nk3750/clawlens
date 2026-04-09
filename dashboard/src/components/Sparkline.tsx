import { useRef, useState } from "react";
import type { RiskTrendPoint } from "../lib/types";
import { riskTierFromScore, riskColorRaw } from "../lib/utils";

interface Props {
  points: RiskTrendPoint[];
  width?: number;
  height?: number;
  onDotClick?: (point: RiskTrendPoint, index: number) => void;
}

const RISK_ZONES = [
  { min: 0, max: 30, color: "#4ade80", opacity: 0.03 },
  { min: 30, max: 60, color: "#fbbf24", opacity: 0.03 },
  { min: 60, max: 80, color: "#f87171", opacity: 0.03 },
  { min: 80, max: 100, color: "#ef4444", opacity: 0.04 },
];

export default function Sparkline({ points, width = 320, height = 100, onDotClick }: Props) {
  const [clickedIdx, setClickedIdx] = useState<number | null>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

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
  const ts = (p: RiskTrendPoint) => new Date(p.timestamp).getTime();

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

  // Gradient area fill path
  const linePath = points
    .map((p, i) => {
      const px = x(ts(p));
      const py = y(p.score);
      return `${i === 0 ? "M" : "L"} ${px} ${py}`;
    })
    .join(" ");

  const areaPath =
    linePath +
    ` L ${x(timestamps[timestamps.length - 1])} ${pad.top + plotH}` +
    ` L ${x(timestamps[0])} ${pad.top + plotH} Z`;

  // Hovered dot info for crosshair + tooltip
  const hoveredPoint = hoveredIdx != null ? points[hoveredIdx] : null;
  const hoveredPx = hoveredPoint ? x(ts(hoveredPoint)) : 0;
  const hoveredPy = hoveredPoint ? y(hoveredPoint.score) : 0;

  // Tooltip positioning
  const tooltipW = 160;
  const tooltipH = 88;
  const tooltipGap = 12;
  let tooltipLeft = hoveredPx - tooltipW / 2;
  tooltipLeft = Math.max(4, Math.min(width - tooltipW - 4, tooltipLeft));
  let tooltipTop = hoveredPy - tooltipH - tooltipGap;
  if (tooltipTop < 0) tooltipTop = hoveredPy + tooltipGap;

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
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

        {/* Risk zone bands */}
        {RISK_ZONES.map((z) => (
          <rect
            key={z.min}
            x={pad.left}
            y={y(z.max)}
            width={plotW}
            height={y(z.min) - y(z.max)}
            fill={z.color}
            fillOpacity={z.opacity}
          />
        ))}

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

        {/* Tier-colored line segments */}
        {points.slice(0, -1).map((p, i) => {
          const next = points[i + 1];
          const maxScore = Math.max(p.score, next.score);
          const segTier = riskTierFromScore(maxScore);
          const segColor = riskColorRaw(segTier);
          return (
            <line
              key={i}
              x1={x(ts(p))}
              y1={y(p.score)}
              x2={x(ts(next))}
              y2={y(next.score)}
              stroke={segColor}
              strokeWidth={1.5}
              strokeOpacity={0.6}
              strokeLinecap="round"
            />
          );
        })}

        {/* Vertical crosshair on hover */}
        {hoveredIdx != null && (
          <line
            x1={hoveredPx}
            y1={hoveredPy}
            x2={hoveredPx}
            y2={pad.top + plotH}
            stroke="var(--cl-text-muted)"
            strokeDasharray="2 3"
            strokeOpacity={0.5}
          />
        )}

        {/* Dots + hit areas */}
        {points.map((p, i) => {
          const tier = riskTierFromScore(p.score);
          const color = riskColorRaw(tier);
          const px = x(ts(p));
          const py = y(p.score);
          const isHovered = hoveredIdx === i;
          const isLast = i === points.length - 1;
          const clickable = !!onDotClick;
          return (
            <g key={i}>
              {/* Hover glow ring */}
              {isHovered && (
                <circle
                  cx={px}
                  cy={py}
                  r={10}
                  fill="none"
                  stroke={color}
                  strokeOpacity={0.3}
                />
              )}

              {/* Visible dot */}
              <circle
                cx={px}
                cy={py}
                r={isHovered ? 6 : 3}
                fill={color}
                filter={p.score > 25 ? "url(#sparkle-glow)" : undefined}
              />

              {/* Latest dot pulse */}
              {isLast && !isHovered && (
                <circle cx={px} cy={py} r={3} fill={color}>
                  <animate
                    attributeName="opacity"
                    values="1;0.35;1"
                    dur="2s"
                    repeatCount="indefinite"
                  />
                </circle>
              )}

              {/* Click highlight ring */}
              {clickedIdx === i && (
                <circle
                  cx={px}
                  cy={py}
                  r={3}
                  fill="none"
                  stroke={color}
                  strokeWidth="1.5"
                >
                  <animate attributeName="r" from="3" to="12" dur="0.5s" fill="freeze" />
                  <animate attributeName="opacity" from="0.8" to="0" dur="0.5s" fill="freeze" />
                </circle>
              )}

              {/* Invisible hit area */}
              <circle
                cx={px}
                cy={py}
                r={12}
                fill="transparent"
                style={clickable ? { cursor: "pointer" } : undefined}
                onMouseEnter={() => setHoveredIdx(i)}
                onMouseLeave={() => setHoveredIdx(null)}
                onClick={
                  clickable
                    ? () => {
                        setClickedIdx(i);
                        onDotClick(p, i);
                        setTimeout(() => setClickedIdx(null), 600);
                      }
                    : undefined
                }
              />
            </g>
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

      {/* HTML tooltip */}
      {hoveredPoint && (
        <div
          style={{
            position: "absolute",
            left: tooltipLeft,
            top: tooltipTop,
            width: tooltipW,
            background: "var(--cl-elevated)",
            border: "1px solid var(--cl-border-subtle)",
            borderRadius: 8,
            padding: "8px 12px",
            fontSize: 12,
            fontFamily: "var(--cl-font-mono, monospace)",
            boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
            pointerEvents: "none",
            zIndex: 10,
          }}
        >
          <div className="flex items-center gap-2 mb-1">
            <span
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: riskColorRaw(riskTierFromScore(hoveredPoint.score)),
              }}
            >
              {hoveredPoint.score}
            </span>
            <span
              className="label-mono"
              style={{ color: riskColorRaw(riskTierFromScore(hoveredPoint.score)) }}
            >
              {riskTierFromScore(hoveredPoint.score).toUpperCase()}
            </span>
          </div>
          <div
            className="truncate"
            style={{ color: "var(--cl-text-secondary)", marginBottom: 2 }}
          >
            {hoveredPoint.toolName.length > 20
              ? `${hoveredPoint.toolName.slice(0, 20)}...`
              : hoveredPoint.toolName}
          </div>
          <div style={{ color: "var(--cl-text-muted)", marginBottom: 2 }}>
            {fmtTime(ts(hoveredPoint))}
          </div>
          {onDotClick && hoveredPoint.sessionKey && (
            <div style={{ color: "var(--cl-accent)" }}>View session &rarr;</div>
          )}
        </div>
      )}
    </div>
  );
}
