import { useState } from "react";
import type { EntryResponse } from "../lib/types";
import { relTime, riskTierFromScore, riskColorRaw, deriveTags, entryIcon, riskLeftBorder, mediumSubTierOpacity } from "../lib/utils";
import { describeEntry } from "../lib/groupEntries";
import DecisionBadge from "./DecisionBadge";
import RiskDetail from "./RiskDetail";

interface Props {
  entry: EntryResponse;
  index: number;
  defaultExpanded?: boolean;
}

const NODE_SIZES: Record<string, number> = {
  low: 10,
  medium: 12,
  high: 14,
  critical: 16,
};

const NODE_GLOW: Record<string, string> = {
  medium: "4px",
  high: "8px",
  critical: "12px",
};

export default function TimelineNode({ entry, index, defaultExpanded = false }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const tier = entry.riskScore != null ? riskTierFromScore(entry.riskScore) : "low";
  const color = riskColorRaw(tier);
  const nodeSize = NODE_SIZES[tier] ?? 10;
  const glow = NODE_GLOW[tier];
  const isBlocked = entry.effectiveDecision === "block" || entry.effectiveDecision === "denied";
  const showBadge = entry.effectiveDecision && entry.effectiveDecision !== "allow";
  const icon = entryIcon(entry);
  const tags = deriveTags(entry);

  // Background tint for high risk / blocked rows
  let rowBg = "transparent";
  if (isBlocked) rowBg = "rgba(248, 113, 113, 0.03)";
  else if (tier === "critical") rowBg = "rgba(239, 68, 68, 0.05)";
  else if (tier === "high") rowBg = "rgba(248, 113, 113, 0.03)";

  const leftBorder = riskLeftBorder(entry.riskScore);
  const showReasoning =
    entry.llmEvaluation && entry.riskScore != null && entry.riskScore >= 30;
  const dotOpacity =
    tier === "medium" ? mediumSubTierOpacity(entry.riskScore ?? 0) : undefined;
  const dotGlow =
    tier === "medium" && (entry.riskScore ?? 0) >= 46
      ? `0 0 8px ${color}80`
      : tier !== "low"
        ? `0 0 6px ${color}60`
        : undefined;

  return (
    <div
      id={`entry-${index}`}
      className="relative"
      style={{
        backgroundColor: expanded ? "var(--cl-elevated)" : rowBg,
        boxShadow: leftBorder,
      }}
    >
      {/* Risk-encoded node on spine */}
      <div
        className="absolute rounded-full border-2 z-10"
        style={{
          width: nodeSize,
          height: nodeSize,
          left: `${19 - nodeSize / 2}px`,
          top: `${18 - nodeSize / 2}px`,
          backgroundColor: color,
          borderColor: color,
          boxShadow: glow ? `0 0 ${glow} ${color}60` : undefined,
          animation: tier === "critical" ? "pulse 2s ease-in-out infinite" : undefined,
        }}
      >
        {isBlocked && (
          <svg
            width={nodeSize - 4}
            height={nodeSize - 4}
            viewBox="0 0 10 10"
            className="absolute"
            style={{ top: 1, left: 1 }}
          >
            <line x1="1" y1="1" x2="9" y2="9" stroke="white" strokeWidth="2" strokeLinecap="round" />
            <line x1="9" y1="1" x2="1" y2="9" stroke="white" strokeWidth="2" strokeLinecap="round" />
          </svg>
        )}
      </div>

      {/* Row content */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left pl-11 pr-4 py-3 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          {/* Category icon */}
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke={icon.color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0"
          >
            <path d={icon.path} />
          </svg>

          {/* Description */}
          <span
            className="text-sm flex-1 min-w-0 truncate"
            style={{ color: "var(--cl-text-primary)" }}
          >
            {describeEntry(entry)}
          </span>

          {/* Inline tags */}
          {tags.length > 0 && (
            <span className="hidden md:flex items-center gap-1 shrink-0">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="label-mono px-1.5 py-0.5 rounded"
                  style={{
                    fontSize: "10px",
                    backgroundColor: "var(--cl-accent-7)",
                    color: "var(--cl-text-secondary)",
                  }}
                >
                  {tag.toUpperCase()}
                </span>
              ))}
            </span>
          )}

          {/* Decision badge */}
          {showBadge && (
            <span className="shrink-0">
              <DecisionBadge decision={entry.effectiveDecision} />
            </span>
          )}

          {/* Risk dot + score + tier label + AI label */}
          {entry.riskScore != null && (
            <span className="flex items-center gap-1.5 shrink-0">
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{
                  backgroundColor: color,
                  opacity: dotOpacity,
                  boxShadow: dotGlow,
                }}
              />
              <span className="font-mono text-xs" style={{ color: "var(--cl-text-secondary)" }}>
                {entry.riskScore}
              </span>
              <span className="label-mono shrink-0" style={{ color }}>
                {tier.toUpperCase()}
              </span>
              {entry.llmEvaluation && entry.llmEvaluation.confidence !== "none" && (
                <span
                  className="label-mono px-1 py-0.5 rounded shrink-0"
                  style={{
                    fontSize: "10px",
                    backgroundColor: "var(--cl-accent-7)",
                    color: "var(--cl-accent)",
                  }}
                >
                  AI
                </span>
              )}
            </span>
          )}

          {/* Relative time */}
          <span className="font-mono text-xs shrink-0" style={{ color: "var(--cl-text-muted)" }}>
            {relTime(entry.timestamp)}
          </span>

          {/* Expand chevron */}
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--cl-text-muted)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0 transition-transform"
            style={{
              transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
              transitionDuration: "var(--cl-spring-duration)",
              transitionTimingFunction: "var(--cl-spring)",
            }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>

        {/* Policy rule for non-allow decisions */}
        {showBadge && entry.policyRule && (
          <div className="mt-1">
            <span className="label-mono" style={{ color: "var(--cl-text-muted)" }}>
              rule: {entry.policyRule}
            </span>
          </div>
        )}

        {/* AI reasoning preview (medium+ only) */}
        {showReasoning && (
          <div
            className="mt-1 text-xs truncate"
            style={{ color: "var(--cl-text-muted)", lineHeight: 1.4 }}
          >
            &ldquo;{entry.llmEvaluation!.reasoning}&rdquo;
          </div>
        )}
      </button>

      {/* Expandable detail */}
      <div
        className="grid transition-all"
        style={{
          gridTemplateRows: expanded ? "1fr" : "0fr",
          transitionDuration: "var(--cl-spring-duration)",
          transitionTimingFunction: "var(--cl-spring)",
        }}
      >
        <div className="overflow-hidden">
          <div className="pl-11 pr-4 pb-4">
            <div className="cl-card p-4">
              <RiskDetail entry={entry} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
