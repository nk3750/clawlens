import { riskColorRaw, riskTierFromScore } from "../../lib/utils";
import { type DayBucket, densityScale } from "./utils";
import { useStripWidth } from "./useStripWidth";

interface Props {
  agentId: string;
  days: DayBucket[];
  maxActions: number;
  todayIso: string;
  height: number;
  onHover: (
    bucket: DayBucket | null,
    event: React.MouseEvent<SVGGElement> | null,
  ) => void;
  onClick: (bucket: DayBucket, event: React.MouseEvent<SVGGElement>) => void;
}

const DOT_R = 5;

export default function FleetChartDayGrid({
  agentId,
  days,
  maxActions,
  todayIso,
  height,
  onHover,
  onClick,
}: Props) {
  const [stripRef, renderWidth] = useStripWidth();
  const cellW = renderWidth / 7;

  return (
    <div
      ref={stripRef}
      style={{ width: "100%", height, position: "relative" }}
      data-cl-fleet-daygrid-container
    >
      <svg
        viewBox={`0 0 ${renderWidth} ${height}`}
        width={renderWidth}
        height={height}
        style={{ display: "block" }}
        data-cl-fleet-day-grid
        data-cl-agent={agentId}
      >
        {days.map((bucket, i) => {
          const x = i * cellW;
          const cx = x + cellW / 2;
          const cy = height / 2;
          const opacity = densityScale(bucket.actions, maxActions);
          const isToday = bucket.iso === todayIso;
          const tier = riskTierFromScore(bucket.peakRisk);
          const dotColor = riskColorRaw(tier);

          return (
            <g
              key={bucket.iso}
              style={{ cursor: "pointer" }}
              onMouseEnter={(e) => onHover(bucket, e)}
              onMouseMove={(e) => onHover(bucket, e)}
              onMouseLeave={() => onHover(null, null)}
              onClick={(e) => onClick(bucket, e)}
              data-cl-day-cell
              data-cl-day-iso={bucket.iso}
              data-cl-day-today={isToday ? "true" : "false"}
            >
              <rect
                x={x + 2}
                y={2}
                width={Math.max(cellW - 4, 1)}
                height={Math.max(height - 4, 1)}
                fill="var(--cl-elevated)"
                opacity={opacity}
                rx={4}
                data-cl-day-density
              />
              {isToday && (
                <rect
                  x={x + 2}
                  y={2}
                  width={Math.max(cellW - 4, 1)}
                  height={Math.max(height - 4, 1)}
                  fill="none"
                  stroke="var(--cl-accent)"
                  strokeWidth={1}
                  rx={4}
                  data-cl-day-today-border
                />
              )}
              {bucket.actions > 0 && (
                <circle
                  cx={cx}
                  cy={cy}
                  r={DOT_R}
                  fill={dotColor}
                  opacity={0.9}
                  data-cl-day-dot
                  data-cl-day-tier={tier}
                />
              )}
              <rect
                x={x}
                y={0}
                width={cellW}
                height={height}
                fill="transparent"
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
