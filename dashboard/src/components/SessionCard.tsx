import { Link } from "react-router-dom";
import type { SessionInfo } from "../lib/types";
import { relTime, formatDuration, parseSessionContext } from "../lib/utils";

export default function SessionCard({ session }: { session: SessionInfo }) {
  const context = parseSessionContext(session.sessionKey);
  const isCron = context.channel === "cron";

  // Only show risk label when elevated
  const riskLabel =
    session.peakRisk > 60 ? "high risk" :
    session.peakRisk > 30 ? "moderate" :
    null;

  const riskColor =
    session.peakRisk > 60 ? "text-risk-high" :
    session.peakRisk > 30 ? "text-risk-medium" :
    "";

  return (
    <Link
      to={`/session/${encodeURIComponent(session.sessionKey)}`}
      className="block bg-card/60 border border-border/50 rounded-xl p-3.5 hover:border-border-hover transition-all duration-200 hover:bg-card group"
    >
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          {/* Trigger type badge */}
          <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium ${
            isCron
              ? "bg-violet-500/10 text-violet-400"
              : "bg-accent/8 text-accent/70"
          }`}>
            {context.label}
          </span>
          <span className="text-[11px] text-muted">
            {relTime(session.startTime)}
          </span>
        </div>
        {riskLabel && (
          <span className={`text-[10px] ${riskColor}`}>{riskLabel}</span>
        )}
      </div>
      <div className="flex items-center gap-3 text-xs text-muted">
        <span><span className="text-secondary font-mono">{session.toolCallCount}</span> actions</span>
        <span>{formatDuration(session.duration)}</span>
      </div>
    </Link>
  );
}
