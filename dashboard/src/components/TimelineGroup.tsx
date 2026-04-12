import { useState } from "react";
import type { EntryGroup } from "../lib/groupEntries";
import { describeEntry, groupVerb } from "../lib/groupEntries";
import { riskTierFromScore, riskColorRaw, formatDuration, deriveTags, entryIcon, riskLeftBorder, mediumSubTierOpacity } from "../lib/utils";

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

  // Use the first entry to derive icon (exec sub-category aware)
  const firstEntry = group.entries[0];
  const icon = firstEntry ? entryIcon(firstEntry) : { path: "", color: "var(--cl-text-muted)" };
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
          backgroundColor: expanded
            ? "var(--cl-elevated)"
            : hasElevated
              ? "rgba(248, 113, 113, 0.02)"
              : "transparent",
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
          <span className="label-mono shrink-0" style={{ color }}>
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
        <div className="mt-1 font-mono text-xs" style={{ color: "var(--cl-text-secondary)" }}>
          {group.entries.length} actions &middot; {formatDuration(group.duration)} &middot;{" "}
          {riskSummary}
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
              const text = describeEntry(entry);
              const tag = deriveTags(entry)[0];

              const entryDotOpacity =
                entryTier === "medium"
                  ? mediumSubTierOpacity(score) * 0.6
                  : 0.6;

              return (
                <div
                  key={entry.toolCallId ?? i}
                  id={`entry-${startIndex + i}`}
                  className="flex items-center gap-2.5 py-1.5"
                  style={{ boxShadow: riskLeftBorder(score) }}
                >
                  {/* Small dot */}
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: entryColor, opacity: entryDotOpacity }}
                  />
                  <span
                    className="text-xs flex-1 min-w-0 truncate"
                    style={{ color: "var(--cl-text-secondary)" }}
                  >
                    {text}
                  </span>
                  {tag && (
                    <span
                      className="label-mono px-1 py-0.5 rounded shrink-0 hidden md:inline"
                      style={{
                        fontSize: "10px",
                        backgroundColor: "var(--cl-accent-7)",
                        color: "var(--cl-text-secondary)",
                      }}
                    >
                      {tag.toUpperCase()}
                    </span>
                  )}
                  <span className="font-mono text-xs shrink-0" style={{ color: entryColor }}>
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
