import type { EntryGroup } from "../lib/groupEntries";
import TimelineMarker from "./TimelineMarker";
import TimelineNode from "./TimelineNode";
import TimelineGroup from "./TimelineGroup";

interface Props {
  groups: EntryGroup[];
  sessionStart: string;
  sessionEnd?: string | null;
  sessionDuration?: number | null;
}

export default function SessionTimeline({ groups, sessionStart, sessionEnd, sessionDuration }: Props) {
  // Build a flat index so each entry's position in the sorted array maps to entry-{index}
  let entryIndex = 0;

  return (
    <div className="relative">
      {/* Vertical spine */}
      <div
        className="absolute top-0 bottom-0 w-px"
        style={{
          left: "18px",
          backgroundColor: "color-mix(in srgb, var(--cl-accent) 12%, transparent)",
        }}
      />

      {/* Session start */}
      <TimelineMarker label="SESSION START" time={sessionStart} />

      {/* Entries — grouped or individual */}
      {groups.map((group) => {
        const currentIndex = entryIndex;
        entryIndex += group.entries.length;

        if (group.entries.length > 1) {
          return (
            <TimelineGroup
              key={group.id}
              group={group}
              startIndex={currentIndex}
            />
          );
        }

        const entry = group.entries[0];
        const shouldAutoExpand =
          (entry.riskScore != null && entry.riskScore >= 50) ||
          entry.effectiveDecision === "block" ||
          entry.effectiveDecision === "denied";

        return (
          <TimelineNode
            key={group.id}
            entry={entry}
            index={currentIndex}
            defaultExpanded={shouldAutoExpand}
          />
        );
      })}

      {/* Session end */}
      {sessionEnd && (
        <TimelineMarker
          label="SESSION END"
          time={sessionEnd}
          duration={sessionDuration}
        />
      )}
    </div>
  );
}
