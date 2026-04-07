import { formatDuration } from "../lib/utils";

interface Props {
  label: "SESSION START" | "SESSION END";
  time: string;
  duration?: number | null;
}

export default function TimelineMarker({ label, time, duration }: Props) {
  const isStart = label === "SESSION START";

  return (
    <div className="relative flex items-center py-3 pl-10">
      {/* Open circle on spine */}
      <div
        className="absolute left-[13px] w-3 h-3 rounded-full border-2"
        style={{
          backgroundColor: "var(--cl-bg)",
          borderColor: isStart ? "var(--cl-accent)" : "var(--cl-text-muted)",
        }}
      />

      {/* Label + time */}
      <span
        className="label-mono"
        style={{ color: isStart ? "var(--cl-accent)" : "var(--cl-text-muted)" }}
      >
        {label}
      </span>
      <span className="label-mono ml-3" style={{ color: "var(--cl-text-muted)" }}>
        {new Date(time).toLocaleTimeString()}
      </span>
      {!isStart && duration != null && (
        <span className="label-mono ml-2" style={{ color: "var(--cl-text-muted)" }}>
          &middot; {formatDuration(duration)}
        </span>
      )}
    </div>
  );
}
