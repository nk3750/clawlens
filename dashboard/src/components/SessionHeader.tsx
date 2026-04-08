import { Link } from "react-router-dom";
import type { SessionInfo } from "../lib/types";
import { formatDuration, riskTierFromScore, riskColor, riskColorRaw } from "../lib/utils";
import GradientAvatar from "./GradientAvatar";
import { useSessionSummary } from "../hooks/useSessionSummary";

interface Props {
  session: SessionInfo;
}

export default function SessionHeader({ session }: Props) {
  const avgTier = riskTierFromScore(session.avgRisk);
  const peakTier = riskTierFromScore(session.peakRisk);
  const { summary, loading: summaryLoading } = useSessionSummary(session.sessionKey);

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

      {/* Agent identity + context */}
      <div className="flex items-center gap-4 mb-4">
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

      {/* AI summary */}
      {summaryLoading ? (
        <div
          className="rounded mb-4"
          style={{
            height: "1rem",
            width: "60%",
            backgroundColor: "var(--cl-surface-raised)",
            animation: "pulse 1.5s ease-in-out infinite",
          }}
        />
      ) : summary ? (
        <div className="flex items-baseline gap-2 mb-4">
          <p className="text-sm italic" style={{ color: "var(--cl-text-secondary)", lineHeight: 1.6 }}>
            &ldquo;{summary}&rdquo;
          </p>
          <span
            className="label-mono shrink-0"
            style={{ fontSize: "9px", color: "var(--cl-text-muted)" }}
          >
            AI-GENERATED
          </span>
        </div>
      ) : null}

      {/* Inline stat strip */}
      <div className="font-mono text-xs flex items-center gap-1.5 flex-wrap" style={{ color: "var(--cl-text-secondary)" }}>
        <span>{session.toolCallCount} actions</span>
        <span style={{ color: "var(--cl-text-muted)" }}>&middot;</span>
        <span>{formatDuration(session.duration)}</span>
        <span style={{ color: "var(--cl-text-muted)" }}>&middot;</span>
        <span>avg <span style={{ color: riskColor(avgTier) }}>{session.avgRisk}</span></span>
        <span style={{ color: "var(--cl-text-muted)" }}>&middot;</span>
        <span>peak <span style={{ color: riskColor(peakTier) }}>{session.peakRisk}</span></span>
        {session.blockedCount > 0 && (
          <>
            <span style={{ color: "var(--cl-text-muted)" }}>&middot;</span>
            <span style={{ color: riskColorRaw("high") }}>{session.blockedCount} blocked</span>
          </>
        )}
      </div>
    </div>
  );
}
