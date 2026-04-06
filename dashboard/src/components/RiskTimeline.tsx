import type { EntryResponse } from "../lib/types";
import { riskTierFromScore, riskColorRaw } from "../lib/utils";

interface Props {
  entries: EntryResponse[];
  sessionStart: string;
  sessionEnd?: string | null;
}

export default function RiskTimeline({ entries, sessionStart, sessionEnd }: Props) {
  const scored = entries.filter((e) => e.riskScore != null);
  if (scored.length === 0) {
    return (
      <div
        className="flex items-center justify-center label-mono py-12"
        style={{ color: "var(--cl-text-muted)" }}
      >
        No risk data for this session
      </div>
    );
  }

  const pad = { top: 16, right: 20, bottom: 32, left: 40 };
  const height = 220;
  const width = 800; // SVG viewBox width, scales responsively
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const startMs = new Date(sessionStart).getTime();
  const endMs = sessionEnd
    ? new Date(sessionEnd).getTime()
    : Math.max(...scored.map((e) => new Date(e.timestamp).getTime()));
  const spanMs = endMs - startMs || 1;

  const x = (ts: string) => pad.left + ((new Date(ts).getTime() - startMs) / spanMs) * plotW;
  const y = (score: number) => pad.top + plotH - (Math.min(score, 100) / 100) * plotH;

  // Tier boundary lines
  const tierLines = [
    { score: 25, label: "Low" },
    { score: 50, label: "Med" },
    { score: 75, label: "High" },
  ];

  // Time labels: start, 25%, 50%, 75%, end
  const fmtTime = (ms: number) => {
    const d = new Date(ms);
    const h = d.getHours();
    const m = d.getMinutes();
    const ampm = h >= 12 ? "pm" : "am";
    const h12 = h % 12 || 12;
    return `${h12}:${String(m).padStart(2, "0")}${ampm}`;
  };

  const timePoints = [0, 0.25, 0.5, 0.75, 1].map((pct) => ({
    ms: startMs + pct * spanMs,
    x: pad.left + pct * plotW,
  }));

  // Find high-risk cluster center for atmospheric halo
  const highRisk = scored.filter((e) => e.riskScore! > 50);
  let haloX: number | null = null;
  let haloY: number | null = null;
  if (highRisk.length >= 2) {
    const avgX = highRisk.reduce((s, e) => s + x(e.timestamp), 0) / highRisk.length;
    const avgY = highRisk.reduce((s, e) => s + y(e.riskScore!), 0) / highRisk.length;
    haloX = avgX;
    haloY = avgY;
  }

  return (
    <div style={{ width: "100%" }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full overflow-visible"
        style={{ height: "clamp(200px, 25vw, 300px)" }}
        preserveAspectRatio="none"
      >
        <defs>
          {/* Glow filter for dots */}
          <filter id="rt-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="rt-glow-strong" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* Atmospheric halo gradient */}
          {haloX != null && haloY != null && (
            <radialGradient id="rt-halo" cx={haloX / width} cy={haloY / height} r="0.25">
              <stop offset="0%" stopColor="#f87171" stopOpacity="0.06" />
              <stop offset="100%" stopColor="#f87171" stopOpacity="0" />
            </radialGradient>
          )}
        </defs>

        {/* Atmospheric halo behind high-risk clusters */}
        {haloX != null && (
          <rect x="0" y="0" width={width} height={height} fill="url(#rt-halo)" />
        )}

        {/* Tier boundary reference lines */}
        {tierLines.map((tl) => (
          <g key={tl.score}>
            <line
              x1={pad.left}
              y1={y(tl.score)}
              x2={width - pad.right}
              y2={y(tl.score)}
              stroke="var(--cl-grid-line)"
              strokeDasharray="4 4"
            />
            <text
              x={pad.left - 6}
              y={y(tl.score)}
              textAnchor="end"
              dominantBaseline="central"
              className="label-mono"
              style={{ fill: "var(--cl-text-muted)", fontSize: 9 }}
            >
              {tl.score}
            </text>
          </g>
        ))}

        {/* Y-axis 0 and 100 */}
        {[0, 100].map((v) => (
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

        {/* X-axis time labels */}
        {timePoints.map((tp, i) => (
          <text
            key={i}
            x={tp.x}
            y={height - 6}
            textAnchor="middle"
            className="label-mono"
            style={{ fill: "var(--cl-text-muted)", fontSize: 9 }}
          >
            {fmtTime(tp.ms)}
          </text>
        ))}

        {/* Connecting line between dots */}
        {scored.length > 1 && (
          <polyline
            points={scored.map((e) => `${x(e.timestamp)},${y(e.riskScore!)}`).join(" ")}
            fill="none"
            stroke="var(--cl-accent)"
            strokeWidth="1"
            strokeOpacity="0.2"
            strokeLinejoin="round"
          />
        )}

        {/* Data dots */}
        {scored.map((e, i) => {
          const tier = riskTierFromScore(e.riskScore!);
          const color = riskColorRaw(tier);
          const isHigh = e.riskScore! > 50;
          const isBlocked = e.effectiveDecision === "block" || e.effectiveDecision === "denied";
          return (
            <g key={e.toolCallId ?? i}>
              <circle
                cx={x(e.timestamp)}
                cy={y(e.riskScore!)}
                r={isBlocked ? 5 : isHigh ? 4 : 3}
                fill={color}
                filter={isHigh ? "url(#rt-glow-strong)" : tier !== "low" ? "url(#rt-glow)" : undefined}
              />
              {/* X mark for blocked actions */}
              {isBlocked && (
                <g stroke={color} strokeWidth="1.5" strokeLinecap="round">
                  <line
                    x1={x(e.timestamp) - 3}
                    y1={y(e.riskScore!) - 3}
                    x2={x(e.timestamp) + 3}
                    y2={y(e.riskScore!) + 3}
                  />
                  <line
                    x1={x(e.timestamp) + 3}
                    y1={y(e.riskScore!) - 3}
                    x2={x(e.timestamp) - 3}
                    y2={y(e.riskScore!) + 3}
                  />
                </g>
              )}
              <title>{`${e.toolName}: risk ${e.riskScore}${isBlocked ? " (BLOCKED)" : ""}`}</title>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
