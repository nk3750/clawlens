import { Link } from "react-router-dom";
import type { SessionInfo } from "../lib/types";
import { relTime, formatDuration, riskTierFromScore } from "../lib/utils";
import RiskBadge from "./RiskBadge";

export default function SessionCard({ session }: { session: SessionInfo }) {
  const tier = session.peakRisk
    ? riskTierFromScore(session.peakRisk)
    : undefined;

  return (
    <Link
      to={`/session/${encodeURIComponent(session.sessionKey)}`}
      className="block bg-card border border-border rounded-xl p-4 hover:border-border-hover transition-all duration-200 hover:bg-elevated/30 group"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-muted">
          {relTime(session.startTime)}
        </span>
        <RiskBadge score={session.peakRisk || undefined} tier={tier} />
      </div>
      <div className="font-mono text-[11px] text-secondary group-hover:text-accent transition-colors truncate mb-2">
        {session.sessionKey}
      </div>
      <div className="flex items-center gap-4 text-xs text-muted">
        <span>
          <span className="text-secondary font-mono">{session.toolCallCount}</span> actions
        </span>
        <span>{formatDuration(session.duration)}</span>
        {session.avgRisk > 0 && (
          <span>
            avg risk <span className="text-secondary font-mono">{session.avgRisk}</span>
          </span>
        )}
      </div>
    </Link>
  );
}
