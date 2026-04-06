import { Link } from "react-router-dom";
import type { SessionInfo } from "../lib/types";
import { formatDuration, riskTierFromScore, riskColor } from "../lib/utils";
import GradientAvatar from "./GradientAvatar";
import ActivityBar from "./ActivityBar";

interface Props {
  session: SessionInfo;
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="cl-card p-4">
      <div className="label-mono mb-1.5" style={{ color: "var(--cl-text-muted)" }}>
        {label}
      </div>
      <div
        className="font-mono text-lg font-semibold"
        style={{ color: color ?? "var(--cl-text-primary)" }}
      >
        {value}
      </div>
    </div>
  );
}

export default function SessionHeader({ session }: Props) {
  const tier = riskTierFromScore(session.peakRisk);

  return (
    <div className="mb-8">
      {/* Breadcrumb */}
      <nav
        className="flex items-center gap-1.5 text-sm mb-8"
        style={{ color: "var(--cl-text-muted)" }}
      >
        <Link to="/" className="transition-colors hover:underline" style={{ color: "var(--cl-text-muted)" }}>
          Agents
        </Link>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <Link
          to={`/agent/${encodeURIComponent(session.agentId)}`}
          className="transition-colors hover:underline"
          style={{ color: "var(--cl-text-muted)" }}
        >
          {session.agentId}
        </Link>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span style={{ color: "var(--cl-text-secondary)" }}>Session</span>
      </nav>

      {/* Agent + context */}
      <div className="flex items-center gap-4 mb-6">
        <Link to={`/agent/${encodeURIComponent(session.agentId)}`} className="shrink-0">
          <GradientAvatar agentId={session.agentId} size="md" />
        </Link>
        <div className="min-w-0">
          <h1
            className="font-display font-bold"
            style={{ fontSize: "var(--text-heading)", color: "var(--cl-text-primary)", lineHeight: 1.2 }}
          >
            Session by{" "}
            <Link
              to={`/agent/${encodeURIComponent(session.agentId)}`}
              className="transition-colors"
              style={{ color: "var(--cl-accent)" }}
            >
              {session.agentId}
            </Link>
          </h1>
          <div className="flex items-center gap-3 mt-1">
            <span className="font-mono text-xs" style={{ color: "var(--cl-text-secondary)" }}>
              {new Date(session.startTime).toLocaleString()}
            </span>
            {session.context && (
              <span className="italic text-sm" style={{ color: "var(--cl-text-muted)" }}>
                &ldquo;{session.context}&rdquo;
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Stat cards grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="ACTIONS" value={String(session.toolCallCount)} />
        <StatCard label="DURATION" value={formatDuration(session.duration)} />
        <StatCard
          label="AVG RISK"
          value={String(session.avgRisk)}
          color={riskColor(riskTierFromScore(session.avgRisk))}
        />
        <StatCard
          label="PEAK RISK"
          value={String(session.peakRisk)}
          color={riskColor(tier)}
        />
      </div>

      {/* Blocked count callout if any */}
      {session.blockedCount > 0 && (
        <div
          className="flex items-center gap-2 px-4 py-2 rounded-lg mb-6"
          style={{
            backgroundColor: "rgba(248, 113, 113, 0.06)",
            border: "1px solid rgba(248, 113, 113, 0.15)",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
          </svg>
          <span className="label-mono" style={{ color: "#f87171" }}>
            {session.blockedCount} action{session.blockedCount > 1 ? "s" : ""} blocked
          </span>
        </div>
      )}

      {/* Activity breakdown */}
      <ActivityBar breakdown={session.activityBreakdown} />

      <div className="cl-divider mt-8" />
    </div>
  );
}
