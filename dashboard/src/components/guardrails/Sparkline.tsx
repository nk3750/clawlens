interface SparklineProps {
  values: number[];
  color: string;
  width?: number;
  height?: number;
}

/**
 * Minimal SVG polyline. No axes, no tooltips, no responsiveness — sized via
 * the parent's chosen width/height. Empty / all-zero input renders a flat
 * baseline rather than crashing.
 */
export default function Sparkline({ values, color, width = 60, height = 14 }: SparklineProps) {
  if (values.length === 0) {
    return (
      <svg width={width} height={height} role="presentation">
        <polyline
          points={`0,${height} ${width},${height}`}
          stroke={color}
          strokeWidth="1.2"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  const max = Math.max(1, ...values);
  const denom = values.length === 1 ? 1 : values.length - 1;
  const points = values
    .map((v, i) => {
      const x = (i * width) / denom;
      const y = height - (v / max) * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  return (
    <svg width={width} height={height} role="presentation">
      <polyline
        points={points}
        stroke={color}
        strokeWidth="1.2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
