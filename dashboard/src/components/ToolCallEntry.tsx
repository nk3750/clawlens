import { useState } from "react";
import type { EntryResponse } from "../lib/types";
import { relTime, riskTierFromScore, riskColorRaw, CATEGORY_META } from "../lib/utils";
import DecisionBadge from "./DecisionBadge";
import RiskDetail from "./RiskDetail";

interface Props {
  entry: EntryResponse;
  description: string;
  /** Auto-expand for high-risk or blocked entries */
  defaultExpanded?: boolean;
}

export default function ToolCallEntry({ entry, description, defaultExpanded = false }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const meta = CATEGORY_META[entry.category];

  const tier = entry.riskScore != null ? riskTierFromScore(entry.riskScore) : null;
  const dotColor = tier ? riskColorRaw(tier) : null;
  const showBadge = entry.effectiveDecision && entry.effectiveDecision !== "allow";

  return (
    <div className="relative pl-8">
      {/* Timeline node dot */}
      <div
        className="absolute left-0 top-4 w-3 h-3 rounded-full border-2 z-10"
        style={{
          backgroundColor: dotColor ?? "var(--cl-elevated)",
          borderColor: dotColor ?? "var(--cl-border-default)",
          boxShadow: tier && tier !== "low" ? `0 0 8px ${dotColor}50` : undefined,
        }}
      />

      {/* Category icon circle */}
      <div
        className="absolute left-6 top-3 w-6 h-6 rounded-full flex items-center justify-center"
        style={{ backgroundColor: "var(--cl-elevated)" }}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke={meta?.color ?? "var(--cl-text-muted)"}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d={meta?.iconPath ?? ""} />
        </svg>
      </div>

      {/* Entry content */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left pl-6 pr-2 py-3 transition-colors rounded-lg"
        style={{
          backgroundColor: expanded ? "var(--cl-elevated)" : "transparent",
        }}
      >
        <div className="flex items-center gap-3">
          {/* Description */}
          <span
            className="text-sm flex-1 min-w-0 truncate"
            style={{ color: "var(--cl-text-primary)" }}
          >
            {description}
          </span>

          {/* Risk score */}
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
        </div>

        {/* Policy rule for non-allow decisions */}
        {showBadge && entry.policyRule && (
          <div className="mt-1 pl-0">
            <span className="label-mono" style={{ color: "var(--cl-text-muted)" }}>
              rule: {entry.policyRule}
            </span>
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
          <div className="pl-6 pr-2 pb-4">
            <div className="cl-card p-4">
              <RiskDetail entry={entry} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
