import { useState } from "react";
import type { EntryResponse } from "../lib/types";
import { riskTierFromScore, riskColorRaw } from "../lib/utils";

interface Props {
  entries: EntryResponse[];
}

export default function SessionRiskLane({ entries }: Props) {
  const [hovered, setHovered] = useState<number | null>(null);

  if (entries.length === 0) return null;

  const count = entries.length;
  // Adaptive sizing: wider bars for few actions, narrow for many
  const gap = count < 10 ? 4 : count < 50 ? 2 : 0;
  const barWidth = count < 10 ? 20 : count < 50 ? Math.max(6, Math.floor(600 / count)) : Math.max(4, Math.floor(600 / count));
  const totalWidth = count * barWidth + Math.max(0, count - 1) * gap;
  const height = 40;
  const maxBarH = 32;

  const scrollTo = (index: number) => {
    const el = document.getElementById(`entry-${index}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div className="mb-8">
      <svg
        viewBox={`0 0 ${totalWidth} ${height}`}
        className="w-full"
        style={{ height: `${height}px`, maxWidth: totalWidth }}
        preserveAspectRatio="none"
      >
        {entries.map((e, i) => {
          const score = e.riskScore ?? 0;
          const tier = riskTierFromScore(score);
          const color = riskColorRaw(tier);
          const barH = Math.max(2, (score / 100) * maxBarH);
          const x = i * (barWidth + gap);
          const y = height - barH;
          const isBlocked = e.effectiveDecision === "block" || e.effectiveDecision === "denied";
          const isHovered = hovered === i;

          return (
            <g
              key={e.toolCallId ?? i}
              onClick={() => scrollTo(i)}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              className="cursor-pointer"
            >
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={barH}
                rx={2}
                fill={color}
                opacity={isHovered ? 1 : 0.75}
              />
              {/* Blocked overlay: red striped pattern */}
              {isBlocked && (
                <line
                  x1={x + 2}
                  y1={y + 2}
                  x2={x + barWidth - 2}
                  y2={y + barH - 2}
                  stroke="#ef4444"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              )}
              {/* Hover highlight */}
              {isHovered && (
                <rect
                  x={x}
                  y={0}
                  width={barWidth}
                  height={height}
                  fill={color}
                  opacity={0.08}
                />
              )}
              <title>{`${e.toolName}: risk ${score}${isBlocked ? " (BLOCKED)" : ""}`}</title>
            </g>
          );
        })}
      </svg>
      {/* Start/end labels */}
      <div className="flex justify-between mt-1">
        <span className="font-mono" style={{ fontSize: "9px", color: "var(--cl-text-muted)" }}>start</span>
        <span className="font-mono" style={{ fontSize: "9px", color: "var(--cl-text-muted)" }}>end</span>
      </div>
    </div>
  );
}
