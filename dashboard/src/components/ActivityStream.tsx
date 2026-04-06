import { useState } from "react";
import type { EntryResponse } from "../lib/types";
import { relTime, riskTierFromScore, riskColorRaw, CATEGORY_META } from "../lib/utils";
import ActivityEntry from "./ActivityEntry";

interface Props {
  entries: EntryResponse[];
}

interface GroupedItem {
  type: "single";
  entry: EntryResponse;
  description: string;
}

interface GroupedCluster {
  type: "group";
  entries: EntryResponse[];
  toolName: string;
  category: EntryResponse["category"];
  description: string;
  /** Individual file descriptions */
  details: string[];
}

type StreamItem = GroupedItem | GroupedCluster;

/** Describe an entry in plain language */
function describeEntry(e: EntryResponse): string {
  const p = e.params;
  switch (e.toolName) {
    case "read": return p.path ? `Read ${p.path}` : "Read file";
    case "write": return p.path ? `Wrote ${p.path}` : "Wrote file";
    case "edit": return p.path ? `Edited ${p.path}` : "Edited file";
    case "exec": return p.command ? `Ran \`${String(p.command).slice(0, 50)}\`` : "Executed command";
    case "message": return p.subject ? `Sent "${p.subject}"` : "Sent message";
    case "fetch_url": return p.url ? `Fetched ${String(p.url).slice(0, 50)}` : "Fetched URL";
    case "grep": return p.pattern ? `Searched for "${p.pattern}"` : "Searched";
    case "glob": return p.pattern ? `Scanned ${p.pattern}` : "Scanned files";
    default: return e.toolName;
  }
}

/** Verb + noun for grouped descriptions */
function groupVerb(toolName: string): { verb: string; noun: string } {
  switch (toolName) {
    case "read": return { verb: "Read", noun: "files" };
    case "write": return { verb: "Wrote", noun: "files" };
    case "edit": return { verb: "Edited", noun: "files" };
    case "exec": return { verb: "Ran", noun: "commands" };
    case "fetch_url": return { verb: "Fetched", noun: "URLs" };
    case "grep": return { verb: "Searched", noun: "patterns" };
    case "glob": return { verb: "Scanned", noun: "patterns" };
    default: return { verb: toolName, noun: "actions" };
  }
}

/** Find common path prefix from params */
function commonPath(entries: EntryResponse[]): string | null {
  const paths = entries
    .map((e) => String(e.params.path ?? e.params.url ?? e.params.command ?? ""))
    .filter(Boolean);
  if (paths.length === 0) return null;
  const parts = paths.map((p) => p.split("/"));
  const common: string[] = [];
  for (let i = 0; i < parts[0].length; i++) {
    const seg = parts[0][i];
    if (parts.every((p) => p[i] === seg)) common.push(seg);
    else break;
  }
  const result = common.join("/");
  return result.length > 1 ? result : null;
}

/** Group consecutive entries with same tool, within 60s, same risk tier, no blocked/approved between */
function groupEntries(entries: EntryResponse[]): StreamItem[] {
  const result: StreamItem[] = [];
  let i = 0;

  while (i < entries.length) {
    const current = entries[i];
    const currentTier = current.riskScore != null ? riskTierFromScore(current.riskScore) : null;
    const isDecision =
      current.effectiveDecision === "block" ||
      current.effectiveDecision === "denied" ||
      current.effectiveDecision === "approved" ||
      current.effectiveDecision === "pending";

    // If it has a notable decision, never group it
    if (isDecision) {
      result.push({ type: "single", entry: current, description: describeEntry(current) });
      i++;
      continue;
    }

    // Try to group consecutive
    const group: EntryResponse[] = [current];
    let j = i + 1;

    while (j < entries.length) {
      const next = entries[j];
      const nextTier = next.riskScore != null ? riskTierFromScore(next.riskScore) : null;
      const nextIsDecision =
        next.effectiveDecision === "block" ||
        next.effectiveDecision === "denied" ||
        next.effectiveDecision === "approved" ||
        next.effectiveDecision === "pending";

      if (nextIsDecision) break;
      if (next.toolName !== current.toolName) break;
      if (nextTier !== currentTier) break;

      // Within 60 seconds
      const timeDiff = Math.abs(
        new Date(current.timestamp).getTime() - new Date(next.timestamp).getTime(),
      );
      if (timeDiff > 60_000) break;

      group.push(next);
      j++;
    }

    if (group.length === 1) {
      result.push({ type: "single", entry: current, description: describeEntry(current) });
    } else {
      const { verb, noun } = groupVerb(current.toolName);
      const cp = commonPath(group);
      const desc = cp
        ? `${verb} ${group.length} ${noun} in ${cp}`
        : `${verb} ${group.length} ${noun}`;
      result.push({
        type: "group",
        entries: group,
        toolName: current.toolName,
        category: current.category,
        description: desc,
        details: group.map((e) => describeEntry(e)),
      });
    }

    i = j;
  }

  return result;
}

function GroupRow({ group }: { group: GroupedCluster }) {
  const [expanded, setExpanded] = useState(false);
  const meta = CATEGORY_META[group.category];
  const firstEntry = group.entries[0];

  const scores = group.entries.filter((e) => e.riskScore != null).map((e) => e.riskScore!);
  const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  const tier = avgScore != null ? riskTierFromScore(avgScore) : null;
  const dotColor = tier ? riskColorRaw(tier) : null;

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
          {group.description}
        </span>

        {/* Avg risk */}
        {avgScore != null && dotColor && (
          <span className="flex items-center gap-1.5 shrink-0">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{
                backgroundColor: dotColor,
                boxShadow: tier !== "low" ? `0 0 6px ${dotColor}60` : undefined,
              }}
            />
            <span className="font-mono text-xs" style={{ color: "var(--cl-text-secondary)" }}>
              avg {avgScore}
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
  const items = groupEntries(entries);

  if (items.length === 0) {
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
      {items.map((item, i) => (
        <div
          key={i}
          style={{
            borderBottom:
              i < items.length - 1
                ? "1px solid var(--cl-border-subtle)"
                : undefined,
          }}
        >
          {item.type === "single" ? (
            <ActivityEntry entry={item.entry} description={item.description} />
          ) : (
            <GroupRow group={item} />
          )}
        </div>
      ))}
    </div>
  );
}
