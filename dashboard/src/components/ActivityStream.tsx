import { useState } from "react";
import type { EntryResponse } from "../lib/types";
import { relTime, riskTierFromScore, riskColorRaw, CATEGORY_META } from "../lib/utils";
import { groupEntries, describeEntry, groupVerb, type EntryGroup } from "../lib/groupEntries";
import ActivityEntry from "./ActivityEntry";

interface Props {
  entries: EntryResponse[];
}

function GroupRow({ group }: { group: EntryGroup }) {
  const [expanded, setExpanded] = useState(false);
  const meta = CATEGORY_META[group.category];
  const firstEntry = group.entries[0];

  const tier = riskTierFromScore(group.avgRisk);
  const dotColor = riskColorRaw(tier);

  const { verb, noun } = groupVerb(group.toolName);
  const desc = group.commonPath
    ? `${verb} ${group.entries.length} ${noun} in ${group.commonPath}`
    : `${verb} ${group.entries.length} ${noun}`;

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

        {/* Group description */}
        <span
          className="text-sm flex-1 min-w-0 truncate"
          style={{ color: "var(--cl-text-primary)" }}
        >
          {desc}
        </span>

        {/* Avg risk */}
        {group.avgRisk > 0 && (
          <span className="flex items-center gap-1.5 shrink-0">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{
                backgroundColor: dotColor,
                boxShadow: tier !== "low" ? `0 0 6px ${dotColor}60` : undefined,
              }}
            />
            <span className="font-mono text-xs" style={{ color: "var(--cl-text-secondary)" }}>
              avg {group.avgRisk}
            </span>
          </span>
        )}

        {/* Timestamp range */}
        <span className="font-mono text-xs shrink-0" style={{ color: "var(--cl-text-secondary)" }}>
          {relTime(firstEntry.timestamp)}
        </span>

        {/* Chevron */}
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

      {/* Expand to show individual entries */}
      <div
        className="grid transition-all"
        style={{
          gridTemplateRows: expanded ? "1fr" : "0fr",
          transitionDuration: "var(--cl-spring-duration)",
          transitionTimingFunction: "var(--cl-spring)",
        }}
      >
        <div className="overflow-hidden">
          <div className="pl-4">
            {group.entries.map((entry, i) => (
              <ActivityEntry
                key={entry.toolCallId ?? i}
                entry={entry}
                description={describeEntry(entry)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ActivityStream({ entries }: Props) {
  const groups = groupEntries(entries);

  if (groups.length === 0) {
    return (
      <p className="p-6 text-center" style={{ color: "var(--cl-text-muted)" }}>
        No activity yet
      </p>
    );
  }

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{
        backgroundColor: "var(--cl-surface)",
        borderColor: "var(--cl-border-subtle)",
      }}
    >
      {groups.map((group, i) => (
        <div
          key={group.id}
          style={{
            borderBottom:
              i < groups.length - 1
                ? "1px solid var(--cl-border-subtle)"
                : undefined,
          }}
        >
          {group.entries.length === 1 ? (
            <ActivityEntry entry={group.entries[0]} description={describeEntry(group.entries[0])} />
          ) : (
            <GroupRow group={group} />
          )}
        </div>
      ))}
    </div>
  );
}
