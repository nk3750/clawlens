import { useNavigate } from "react-router-dom";
import type { TimelineSession } from "../../lib/types";
import { riskColorRaw, riskTierFromScore } from "../../lib/utils";
import type { RangeOption } from "../fleetheader/utils";
import {
  cluster as clusterSessions,
  isAttentionSession,
  makeTimeToX,
  type Cluster,
} from "./utils";
import { useStripWidth } from "./useStripWidth";

interface Props {
  range: RangeOption;
  agentSessions: TimelineSession[];
  pendingSessionKeys: ReadonlySet<string>;
  breathingRingKeys: ReadonlySet<string>;
  ghostNextRunMs: number | null;
  startMs: number;
  endMs: number;
  nowMs: number;
  isToday: boolean;
  height: number;
  /**
   * When true the ▼ + "NOW" caption renders above this row's NOW line.
   * Only the first fleet row sets this — the rest get the in-strip NOW line
   * without the caption so all agents share one visual marker. Anchored in
   * the strip's own coordinate space so the cap stays locked to the actual
   * right-edge of the rendered strip, not the parent body's stale width.
   */
  showNowCap?: boolean;
  onHover: (
    c: Cluster | null,
    event: React.MouseEvent<SVGGElement> | null,
  ) => void;
  onClick: (c: Cluster, event: React.MouseEvent<SVGGElement>) => void;
}

const DOT_ROUTINE_R = 4;
const DOT_ATTENTION_R = 6;
const HIT_R = 12;

function hideGhost(range: RangeOption): boolean {
  return range === "12h" || range === "24h";
}

export default function FleetChartTimelineStrip({
  range,
  agentSessions,
  pendingSessionKeys,
  breathingRingKeys,
  ghostNextRunMs,
  startMs,
  endMs,
  nowMs,
  isToday,
  height,
  showNowCap = false,
  onHover,
  onClick,
}: Props) {
  const navigate = useNavigate();
  const [stripRef, renderWidth] = useStripWidth();

  const timeToX = makeTimeToX(startMs, endMs, renderWidth);
  const cy = height / 2;
  const clusters = clusterSessions(agentSessions, timeToX, pendingSessionKeys);
  const nowX = isToday ? timeToX(nowMs) : null;
  const capVisible =
    showNowCap && nowX !== null && nowX >= 0 && nowX <= renderWidth;

  return (
    <div
      ref={stripRef}
      style={{ width: "100%", height, position: "relative" }}
      data-cl-fleet-strip-container
    >
      {capVisible && nowX !== null && (
        <div
          data-cl-fleet-now-cap
          style={{
            position: "absolute",
            top: -12,
            left: nowX,
            transform: "translateX(-50%)",
            pointerEvents: "none",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            zIndex: 5,
            animation: "pulse 2s ease-in-out infinite",
          }}
        >
          <span
            className="label-mono"
            style={{
              color: "var(--cl-accent)",
              fontSize: 9,
              lineHeight: 1,
            }}
          >
            NOW
          </span>
          <span
            style={{
              color: "var(--cl-accent)",
              fontSize: 9,
              lineHeight: 1,
              marginTop: 1,
            }}
          >
            ▼
          </span>
        </div>
      )}
      <svg
        viewBox={`0 0 ${renderWidth} ${height}`}
        width={renderWidth}
        height={height}
        style={{ display: "block" }}
        data-cl-fleet-strip
      >
        {/* Baseline guide */}
        <line
          x1={0}
          x2={renderWidth}
          y1={height - 6}
          y2={height - 6}
          stroke="var(--cl-border-subtle)"
          strokeWidth={0.5}
        />

        {/* Ghost marker (next scheduled run) */}
        {ghostNextRunMs !== null &&
          !hideGhost(range) &&
          ghostNextRunMs > nowMs &&
          ghostNextRunMs <= endMs && (
            <circle
              cx={timeToX(ghostNextRunMs)}
              cy={cy}
              r={DOT_ROUTINE_R}
              fill="none"
              stroke="var(--cl-text-muted)"
              strokeWidth={1}
              strokeDasharray="2 2"
              opacity={0.5}
              data-cl-fleet-ghost
            />
          )}

        {/* Dots / clusters (front) */}
        {clusters.map((c) => {
          const hasAttention = c.isCluster
            ? c.peakRisk >= 65 || c.blockedCount > 0 || c.hasPending
            : isAttentionSession(c.sessions[0], pendingSessionKeys);
          const r = hasAttention ? DOT_ATTENTION_R : DOT_ROUTINE_R;
          const tier = riskTierFromScore(c.peakRisk);
          const color = riskColorRaw(tier);
          const key = c.sessions.map((s) => s.sessionKey).join("|");
          const showBreathing =
            c.sessions.some((s) => breathingRingKeys.has(s.sessionKey)) &&
            (range === "1h" || range === "3h");
          // Clamp the visible circle's center so a session whose startTime
          // sits outside the window doesn't render clipped against the
          // strip edge. Bound at the widest visible radius (r + 4, the
          // pending-crown outer ring) so EVERY ring — attention, pending,
          // breathing — stays fully inside the strip. Routine dots accept
          // the matching 4-px inset; consistency across variants wins over
          // tight-to-edge rendering. Hit area uses its own HIT_R clamp so
          // pointer events land on the rendered dot even when pushed in.
          const outerR = r + 4;
          const dotCx = Math.max(
            outerR,
            Math.min(c.cx, renderWidth - outerR),
          );
          const hitCx = Math.max(HIT_R, Math.min(c.cx, renderWidth - HIT_R));

          return (
            <g
              key={key}
              style={{ cursor: "pointer" }}
              onMouseEnter={(e) => onHover(c, e)}
              onMouseMove={(e) => onHover(c, e)}
              onMouseLeave={() => onHover(null, null)}
              onClick={(e) => {
                if (c.isCluster) {
                  onClick(c, e);
                } else {
                  navigate(
                    `/session/${encodeURIComponent(c.sessions[0].sessionKey)}`,
                  );
                }
              }}
              data-cl-fleet-dot
              data-cl-cluster={c.isCluster ? "true" : "false"}
              data-cl-risk-tier={tier}
            >
              {/* Core dot */}
              <circle cx={dotCx} cy={cy} r={r} fill={color} opacity={0.9} />

              {/* Attention ring */}
              {hasAttention && (
                <circle
                  cx={dotCx}
                  cy={cy}
                  r={r + 2}
                  fill="none"
                  stroke={color}
                  strokeWidth={1.5}
                  opacity={0.55}
                  data-cl-fleet-attention-ring
                />
              )}

              {/* Pending crown */}
              {c.hasPending && (
                <circle
                  cx={dotCx}
                  cy={cy}
                  r={r + 4}
                  fill="none"
                  stroke="var(--cl-risk-medium)"
                  strokeWidth={1}
                  strokeDasharray="2 2"
                  data-cl-fleet-pending
                >
                  <animate
                    attributeName="opacity"
                    values="0.4;0.8;0.4"
                    dur="2s"
                    repeatCount="indefinite"
                  />
                </circle>
              )}

              {/* Blocked glyph */}
              {c.blockedCount > 0 && (
                <g data-cl-fleet-blocked>
                  <circle
                    cx={dotCx + r}
                    cy={cy - r}
                    r={2.5}
                    fill="var(--cl-risk-high)"
                  />
                  <line
                    x1={dotCx + r - 1.3}
                    y1={cy - r - 1.3}
                    x2={dotCx + r + 1.3}
                    y2={cy - r + 1.3}
                    stroke="var(--cl-surface)"
                    strokeWidth={0.8}
                    strokeLinecap="round"
                  />
                </g>
              )}

              {/* Cluster count badge */}
              {c.isCluster && (
                <text
                  x={dotCx}
                  y={cy - r - 4}
                  textAnchor="middle"
                  className="label-mono"
                  style={{
                    fill: "var(--cl-text-secondary)",
                    fontSize: 9,
                    fontWeight: 700,
                  }}
                  data-cl-fleet-cluster-count
                >
                  {c.sessions.length}
                </text>
              )}

              {/* Active breathing ring */}
              {showBreathing && (
                <circle
                  cx={dotCx}
                  cy={cy}
                  r={r}
                  fill="none"
                  stroke={color}
                  strokeWidth={1.5}
                  data-cl-fleet-breathing
                >
                  <animate
                    attributeName="r"
                    from={String(r)}
                    to={String(r + 8)}
                    dur="2s"
                    repeatCount="indefinite"
                  />
                  <animate
                    attributeName="opacity"
                    from="0.6"
                    to="0"
                    dur="2s"
                    repeatCount="indefinite"
                  />
                </circle>
              )}

              {/* Invisible hit target */}
              <circle cx={hitCx} cy={cy} r={HIT_R} fill="transparent" />
            </g>
          );
        })}

        {/* NOW line inside this strip */}
        {nowX !== null && nowX >= 0 && nowX <= renderWidth && (
          <line
            x1={nowX}
            x2={nowX}
            y1={0}
            y2={height}
            stroke="var(--cl-accent)"
            strokeWidth={1}
            opacity={0.4}
            data-cl-fleet-now-line
          >
            <animate
              attributeName="opacity"
              values="0.25;0.55;0.25"
              dur="2s"
              repeatCount="indefinite"
            />
          </line>
        )}
      </svg>
    </div>
  );
}
