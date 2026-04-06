import type { EntryResponse } from "../lib/types";
import ToolCallEntry from "./ToolCallEntry";

interface Props {
  entries: EntryResponse[];
  sessionStart: string;
}

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

export default function ToolCallTimeline({ entries, sessionStart }: Props) {
  // Chronological order (earliest first)
  const sorted = [...entries].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  if (sorted.length === 0) {
    return (
      <p className="p-6 text-center" style={{ color: "var(--cl-text-muted)" }}>
        No actions in this session
      </p>
    );
  }

  return (
    <div className="relative">
      {/* Vertical connecting line */}
      <div
        className="absolute left-[5px] top-4 bottom-4 w-px"
        style={{ backgroundColor: "var(--cl-border-subtle)" }}
      />

      {/* Tool call entries */}
      <div className="space-y-0.5">
        {sorted.map((entry, i) => {
          const shouldAutoExpand =
            (entry.riskScore != null && entry.riskScore >= 50) ||
            entry.effectiveDecision === "block" ||
            entry.effectiveDecision === "denied";

          return (
            <ToolCallEntry
              key={entry.toolCallId ?? i}
              entry={entry}
              description={describeEntry(entry)}
              defaultExpanded={shouldAutoExpand}
            />
          );
        })}
      </div>

      {/* SESSION START marker */}
      <div className="relative pl-8 mt-2">
        <div
          className="absolute left-0 top-2 w-3 h-3 rounded-full border-2"
          style={{
            backgroundColor: "var(--cl-bg)",
            borderColor: "var(--cl-accent)",
          }}
        />
        <div className="pl-6 py-2">
          <span className="label-mono" style={{ color: "var(--cl-accent)" }}>
            SESSION START
          </span>
          <span className="label-mono ml-3" style={{ color: "var(--cl-text-muted)" }}>
            {new Date(sessionStart).toLocaleString()}
          </span>
        </div>
      </div>
    </div>
  );
}
