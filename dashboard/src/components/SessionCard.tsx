import { Link } from "react-router-dom";
import type { SessionInfo } from "../lib/types";
import { relTime, riskTierFromScore, riskColor, formatDuration } from "../lib/utils";

interface Props {
  session: SessionInfo;
}

export default function SessionCard({ session }: Props) {
  const tier = riskTierFromScore(session.avgRisk);
  const tierLabel =
    tier === "low" ? "Low" :
    tier === "medium" ? "Medium" :
    tier === "high" ? "High" : "Critical";

  return (
    <Link
      to={`/session/${encodeURIComponent(session.sessionKey)}`}
      className="cl-card block p-4 cursor-pointer shrink-0"
      style={{ width: "clamp(200px, 30vw, 260px)" }}
    >
      <div className="label-mono mb-2" style={{ color: "var(--cl-text-secondary)" }}>
        {relTime(session.startTime)}
      </div>

      {session.context && (
        <p
          className="text-sm mb-2 truncate"
          style={{ color: "var(--cl-text-primary)" }}
        >
          {session.context}
        </p>
      )}

      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm" style={{ color: "var(--cl-text-primary)" }}>
          {session.toolCallCount} actions
        </span>
        {session.duration != null && (
          <span className="label-mono" style={{ color: "var(--cl-text-muted)" }}>
            {formatDuration(session.duration)}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <span
          className="label-mono"
          style={{ color: riskColor(tier) }}
        >
          avg {session.avgRisk}
        </span>
        <span className="label-mono" style={{ color: "var(--cl-text-muted)" }}>
          {tierLabel}
        </span>
        {session.blockedCount > 0 && (
          <span
            className="label-mono px-1.5 py-0.5 rounded"
            style={{
              backgroundColor: "rgba(248, 113, 113, 0.08)",
              color: "#f87171",
            }}
          >
            {session.blockedCount} blocked
          </span>
        )}
      </div>
    </Link>
  );
}
