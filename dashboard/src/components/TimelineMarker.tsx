import { formatDuration, riskColorRaw, riskTierFromScore } from "../lib/utils";

interface Props {
  label: "SESSION START" | "SESSION END";
  time: string;
  duration?: number | null;
  context?: string;
  blockedCount?: number;
  peakRisk?: number;
}

export default function TimelineMarker({
  label,
  time,
  duration,
  context,
  blockedCount,
  peakRisk,
}: Props) {
  const isStart = label === "SESSION START";

  return (
    <div className="relative flex items-center gap-2 py-3 pl-10 flex-wrap">
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
      <span className="label-mono" style={{ color: "var(--cl-text-muted)" }}>
        {new Date(time).toLocaleTimeString()}
      </span>

      {/* START: via context */}
      {isStart && context && (
        <span className="label-mono" style={{ color: "var(--cl-text-muted)" }}>
          &middot; via {context}
        </span>
      )}

      {/* END: duration + blocks + peak risk */}
      {!isStart && (
        <>
          {duration != null && (
            <span className="label-mono" style={{ color: "var(--cl-text-muted)" }}>
              &middot; {formatDuration(duration)}
            </span>
          )}
          <span className="label-mono" style={{ color: "var(--cl-text-muted)" }}>
            &middot; {blockedCount ? `${blockedCount} blocked` : "no blocks"}
          </span>
          {peakRisk != null && peakRisk > 0 && (
            <span
              className="label-mono"
              style={{ color: riskColorRaw(riskTierFromScore(peakRisk)) }}
            >
              &middot; peak {peakRisk}
            </span>
          )}
        </>
      )}
    </div>
  );
}
