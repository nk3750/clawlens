import { useEffect, useState } from "react";
import { riskTierFromScore, riskColor, riskColorRaw } from "../lib/utils";

interface Props {
  score: number;
  size?: number;
}

export default function RiskArc({ score, size = 80 }: Props) {
  const [animated, setAnimated] = useState(false);

  useEffect(() => {
    // Delay to allow mount, then trigger arc animation
    const raf = requestAnimationFrame(() => setAnimated(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const tier = riskTierFromScore(score);
  const color = riskColor(tier);
  const rawColor = riskColorRaw(tier);
  const tierLabel =
    tier === "low" ? "Low risk" :
    tier === "medium" ? "Medium" :
    tier === "high" ? "High" : "Critical";

  // Semi-circle arc math
  const cx = size / 2;
  const cy = size * 0.55;
  const r = size * 0.38;
  const strokeWidth = size * 0.05;
  const totalArc = Math.PI;

  function arcPath(angle: number) {
    const x = cx + r * Math.cos(Math.PI - angle);
    const y = cy - r * Math.sin(angle);
    return `${x} ${y}`;
  }

  const bgPath = `M ${arcPath(0)} A ${r} ${r} 0 1 1 ${arcPath(totalArc)}`;
  const arcLength = Math.PI * r;
  const dashTarget = arcLength - (score / 100) * arcLength;

  return (
    <div className="flex items-center gap-3">
      <svg
        width={size}
        height={size * 0.65}
        viewBox={`0 0 ${size} ${size * 0.65}`}
        className="overflow-visible"
      >
        {/* Glow filter */}
        <defs>
          <filter id={`glow-${score}-${size}`} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Background track */}
        <path
          d={bgPath}
          fill="none"
          stroke="var(--cl-elevated)"
          strokeWidth={strokeWidth + 1}
          strokeLinecap="round"
        />

        {/* Filled arc with glow — animates from empty to final */}
        <path
          d={bgPath}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={arcLength}
          strokeDashoffset={animated ? dashTarget : arcLength}
          filter={`url(#glow-${score}-${size})`}
          style={{
            transition: `stroke-dashoffset 0.8s var(--cl-spring)`,
          }}
        />

        {/* Score number */}
        <text
          x={cx}
          y={cy - r * 0.15}
          textAnchor="middle"
          dominantBaseline="central"
          className="font-display"
          style={{
            fill: "var(--cl-text-primary)",
            fontSize: size * 0.24,
            fontWeight: 700,
          }}
        >
          {score}
        </text>
      </svg>
      <span
        className="label-mono"
        style={{
          color,
          textShadow: `0 0 8px ${rawColor}30`,
        }}
      >
        {tierLabel}
      </span>
    </div>
  );
}
