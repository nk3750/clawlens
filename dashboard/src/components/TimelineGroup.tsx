import { useState } from "react";
import type { EntryGroup } from "../lib/groupEntries";
import { describeEntry, groupVerb } from "../lib/groupEntries";
import type { ActivityCategory } from "../lib/types";
import { riskTierFromScore, riskColorRaw, formatDuration, CATEGORY_META } from "../lib/utils";

const EXEC_ICON_PATHS: Record<string, string> = {
  git: "M15 22v-4a4.8 4.8 0 00-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 004 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65S8.93 17.38 9 18v4",
  warning: "M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z M12 9v4 M12 17h.01",
};

function getGroupIcon(category: ActivityCategory, execCategory?: string): { path: string; color: string } {
  const meta = CATEGORY_META[category];
  const defaultIcon = { path: meta?.iconPath ?? "", color: meta?.color ?? "var(--cl-text-muted)" };
  if (!execCategory) return defaultIcon;
  switch (execCategory) {
    case "network-read": case "network-write":
      return { path: CATEGORY_META.web.iconPath, color: CATEGORY_META.web.color };
    case "read-only": case "search":
      return { path: CATEGORY_META.exploring.iconPath, color: CATEGORY_META.exploring.color };
    case "git-read": case "git-write":
      return { path: EXEC_ICON_PATHS.git, color: "var(--cl-cat-commands)" };
    case "destructive":
      return { path: EXEC_ICON_PATHS.warning, color: "var(--cl-risk-high)" };
    default: return defaultIcon;
  }
}

interface Props {
  group: EntryGroup;
  /** Index of the first entry in this group within the full sorted entries array */
  startIndex: number;
}

const INITIAL_SHOW = 5;

export default function TimelineGroup({ group, startIndex }: Props) {
  const hasElevated = group.entries.some((e) => (e.riskScore ?? 0) >= 50);
  const [expanded, setExpanded] = useState(hasElevated);
  const [showAll, setShowAll] = useState(false);

  // Use exec sub-category icon if all entries share the same exec category
  const firstExecCat = group.entries[0]?.execCategory;
  const icon = getGroupIcon(group.category, firstExecCat);
  const color = riskColorRaw(group.riskTier);
  const tier = group.riskTier;

  const { verb, noun } = groupVerb(group.toolName);
  const desc = group.commonPath
    ? `${verb} ${group.entries.length} ${noun} in ${group.commonPath}`
    : `${verb} ${group.entries.length} ${noun}`;

  const riskSummary = (() => {
    const tiers = new Set(group.entries.map((e) => riskTierFromScore(e.riskScore ?? 0)));
    if (tiers.size === 1) return `all ${[...tiers][0]} risk`;
    return `avg ${group.avgRisk}, peak ${group.peakRisk}`;
  })();

  const visibleEntries = showAll ? group.entries : group.entries.slice(0, INITIAL_SHOW);
  const remaining = group.entries.length - INITIAL_SHOW;

  return (
    <div id={`entry-${startIndex}`} className="relative">
      {/* Double-ring node on spine */}
      <div
        className="absolute z-10"
        style={{
          width: 14,
          height: 14,
          left: 12,
          top: 15,
        }}
      >
        <div
          className="w-full h-full rounded-full border-2"
          style={{
            borderColor: color,
            backgroundColor: "transparent",
          }}
        >
          <div
            className="absolute rounded-full"
            style={{
              width: 6,
              height: 6,
              top: 2,
              left: 2,
              backgroundColor: color,
              boxShadow: tier !== "low" ? `0 0 6px ${color}60` : undefined,
            }}
          />
        </div>
      </div>

      {/* Group header row */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left pl-11 pr-4 py-3 transition-colors"
        style={{
          backgroundColor: expanded ? "var(--cl-elevated)" : hasElevated ? "rgba(248, 113, 113, 0.02)" : "transparent",
        }}
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

          {/* Group description */}
          <span
            className="text-sm flex-1 min-w-0 truncate"
            style={{ color: "var(--cl-text-primary)" }}
          >
            {desc}
          </span>

          {/* Avg risk */}
          <span className="flex items-center gap-1.5 shrink-0">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{
                backgroundColor: color,
                boxShadow: tier !== "low" ? `0 0 6px ${color}60` : undefined,
              }}
            />
            <span className="font-mono text-xs" style={{ color: "var(--cl-text-secondary)" }}>
              avg {group.avgRisk}
            </span>
          </span>

          {/* Tier label */}
          <span
            className="label-mono shrink-0"
            style={{ color }}
          >
            {tier.toUpperCase()}
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

        {/* Subtitle */}
        <div className="mt-1 font-mono text-xs" style={{ color: "var(--cl-text-muted)" }}>
          {group.entries.length} actions &middot; {formatDuration(group.duration)} &middot; {riskSummary}
        </div>
      </button>

      {/* Expandable individual entries */}
      <div
        className="grid transition-all"
        style={{
          gridTemplateRows: expanded ? "1fr" : "0fr",
          transitionDuration: "var(--cl-spring-duration)",
          transitionTimingFunction: "var(--cl-spring)",
        }}
      >
        <div className="overflow-hidden">
          <div className="pl-11 pr-4 pb-2">
            {visibleEntries.map((entry, i) => {
              const score = entry.riskScore ?? 0;
              const entryTier = riskTierFromScore(score);
              const entryColor = riskColorRaw(entryTier);
              // Simplified: just filename/command + score
              const text = describeEntry(entry);
              const shortText = (() => {
                const p = entry.params;
                if (p.path) {
                  const full = String(p.path);
                  const parts = full.split("/");
                  return parts[parts.length - 1] || full;
                }
                return text;
              })();

              return (
                <div
                  key={entry.toolCallId ?? i}
                  id={`entry-${startIndex + i}`}
                  className="flex items-center gap-2.5 py-1.5"
                >
                  {/* Small dot */}
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: entryColor, opacity: 0.6 }}
                  />
                  <span
                    className="text-xs flex-1 min-w-0 truncate"
                    style={{ color: "var(--cl-text-secondary)" }}
                  >
                    {shortText}
                  </span>
                  <span className="font-mono text-xs shrink-0" style={{ color: "var(--cl-text-muted)" }}>
                    {score}
                  </span>
                </div>
              );
            })}

            {/* "Show all" link */}
            {!showAll && remaining > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowAll(true);
                }}
                className="text-xs font-mono py-1.5 transition-colors"
                style={{ color: "var(--cl-accent)" }}
              >
                show all {group.entries.length}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
