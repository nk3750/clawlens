import { useState } from "react";
import type { EntryResponse } from "../lib/types";
import { relTime, riskTierFromScore, riskColorRaw, CATEGORY_META } from "../lib/utils";
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

// Extra icon paths not in CATEGORY_META
const ICON_PATHS = {
  git: "M15 22v-4a4.8 4.8 0 00-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 004 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65S8.93 17.38 9 18v4",
  warning: "M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z M12 9v4 M12 17h.01",
};

/** Pick the right icon path based on exec sub-category */
function getIconForEntry(entry: EntryResponse): { path: string; color: string } {
  const meta = CATEGORY_META[entry.category];
  const defaultIcon = { path: meta?.iconPath ?? "", color: meta?.color ?? "var(--cl-text-muted)" };

  if (entry.toolName !== "exec" || !entry.execCategory) return defaultIcon;

  switch (entry.execCategory) {
    case "network-read":
    case "network-write":
      return { path: CATEGORY_META.web.iconPath, color: CATEGORY_META.web.color };
    case "read-only":
    case "search":
      return { path: CATEGORY_META.exploring.iconPath, color: CATEGORY_META.exploring.color };
    case "git-read":
    case "git-write":
      return { path: ICON_PATHS.git, color: "var(--cl-cat-commands)" };
    case "destructive":
      return { path: ICON_PATHS.warning, color: "var(--cl-risk-high)" };
    default:
      return defaultIcon;
  }
}

export default function TimelineNode({ entry, index, defaultExpanded = false }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const tier = entry.riskScore != null ? riskTierFromScore(entry.riskScore) : "low";
  const color = riskColorRaw(tier);
  const nodeSize = NODE_SIZES[tier] ?? 10;
  const glow = NODE_GLOW[tier];
  const isBlocked = entry.effectiveDecision === "block" || entry.effectiveDecision === "denied";
  const showBadge = entry.effectiveDecision && entry.effectiveDecision !== "allow";
  const icon = getIconForEntry(entry);
  const tags = entry.riskTags?.slice(0, 2) ?? [];

  // Background tint for high risk / blocked rows
  let rowBg = "transparent";
  if (isBlocked) rowBg = "rgba(248, 113, 113, 0.03)";
  else if (tier === "critical") rowBg = "rgba(239, 68, 68, 0.05)";
  else if (tier === "high") rowBg = "rgba(248, 113, 113, 0.03)";

  return (
    <div
      id={`entry-${index}`}
      className="relative"
      style={{ backgroundColor: expanded ? "var(--cl-elevated)" : rowBg }}
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

          {/* Inline risk tags */}
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

          {/* Risk dot + score + AI sparkle */}
          {entry.riskScore != null && (
            <span className="flex items-center gap-1.5 shrink-0">
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{
                  backgroundColor: color,
                  boxShadow: tier !== "low" ? `0 0 6px ${color}60` : undefined,
                }}
              />
              <span className="font-mono text-xs" style={{ color: "var(--cl-text-secondary)" }}>
                {entry.riskScore}
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
