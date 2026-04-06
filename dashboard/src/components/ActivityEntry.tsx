import { useState } from "react";
import type { EntryResponse } from "../lib/types";
import { relTime, riskTierFromScore, riskColorRaw, CATEGORY_META } from "../lib/utils";
import DecisionBadge from "./DecisionBadge";
import RiskDetail from "./RiskDetail";

interface Props {
  entry: EntryResponse;
  /** Plain-language description */
  description: string;
}

export default function ActivityEntry({ entry, description }: Props) {
  const [expanded, setExpanded] = useState(false);
  const meta = CATEGORY_META[entry.category];

  const tier = entry.riskScore != null ? riskTierFromScore(entry.riskScore) : null;
  const dotColor = tier ? riskColorRaw(tier) : null;
  const showBadge =
    entry.effectiveDecision &&
    entry.effectiveDecision !== "allow";

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors"
        style={{
          backgroundColor: expanded ? "var(--cl-elevated)" : "transparent",
        }}
      >
        {/* Category icon */}
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke={meta?.color ?? "var(--cl-text-muted)"}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0"
        >
          <path d={meta?.iconPath ?? ""} />
        </svg>

        {/* Description */}
        <span
          className="text-sm flex-1 min-w-0 truncate"
          style={{ color: "var(--cl-text-primary)" }}
        >
          {description}
        </span>

        {/* Risk dot */}
        {entry.riskScore != null && dotColor && (
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
          </span>
        )}

        {/* Decision badge */}
        {showBadge && (
          <span className="shrink-0">
            <DecisionBadge decision={entry.effectiveDecision} />
          </span>
        )}

        {/* Timestamp */}
        <span
          className="font-mono text-xs shrink-0"
          style={{ color: "var(--cl-text-secondary)" }}
        >
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
