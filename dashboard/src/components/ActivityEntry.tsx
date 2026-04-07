import { useState } from "react";
import type { EntryResponse } from "../lib/types";
import { relTime, riskTierFromScore, riskColorRaw, deriveTags, entryIcon } from "../lib/utils";
import DecisionBadge from "./DecisionBadge";
import RiskDetail from "./RiskDetail";

interface Props {
  entry: EntryResponse;
  /** Plain-language description */
  description: string;
}

export default function ActivityEntry({ entry, description }: Props) {
  const [expanded, setExpanded] = useState(false);
  const icon = entryIcon(entry);

  const tier = entry.riskScore != null ? riskTierFromScore(entry.riskScore) : null;
  const dotColor = tier ? riskColorRaw(tier) : null;
  const showBadge = entry.effectiveDecision && entry.effectiveDecision !== "allow";
  const tags = deriveTags(entry);

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors"
        style={{
          backgroundColor: expanded ? "var(--cl-elevated)" : "transparent",
        }}
      >
        {/* Category icon (exec sub-category aware) */}
        <svg
          width="16"
          height="16"
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
          {description}
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

        {/* Risk dot + score + tier */}
        {entry.riskScore != null && dotColor && tier && (
          <span className="flex items-center gap-1.5 shrink-0">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{
                backgroundColor: dotColor,
                boxShadow: tier !== "low" ? `0 0 6px ${dotColor}60` : undefined,
              }}
            />
            <span className="font-mono text-xs" style={{ color: "var(--cl-text-secondary)" }}>
              {entry.riskScore}
            </span>
            <span className="label-mono shrink-0" style={{ color: dotColor }}>
              {tier.toUpperCase()}
            </span>
            {entry.llmEvaluation && (
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="var(--cl-accent)"
                className="shrink-0"
              >
                <path d="M12 2L14 10L22 12L14 14L12 22L10 14L2 12L10 10Z" />
              </svg>
            )}
          </span>
        )}

        {/* Decision badge */}
        {showBadge && (
          <span className="shrink-0">
            <DecisionBadge decision={entry.effectiveDecision} />
          </span>
        )}

        {/* Timestamp */}
        <span className="font-mono text-xs shrink-0" style={{ color: "var(--cl-text-secondary)" }}>
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
      </button>

      {/* Expandable detail panel */}
      <div
        className="grid transition-all"
        style={{
          gridTemplateRows: expanded ? "1fr" : "0fr",
          transitionDuration: "var(--cl-spring-duration)",
          transitionTimingFunction: "var(--cl-spring)",
        }}
      >
        <div className="overflow-hidden">
          <div className="px-4 pb-4 pl-11">
            <RiskDetail entry={entry} />
          </div>
        </div>
      </div>
    </div>
  );
}
