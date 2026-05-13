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
  const {
    summary,
    summaryKind,
    isLlmGenerated,
    loading: summaryLoading,
    generate,
  } = useSessionSummary(session.sessionKey);
  // Backend-decided source of truth for the degraded state — same /api/
  // session/:key/summary response that the card popover reads (issue #76).
  const isDegradedNoKey = summaryKind === "degraded_no_key";

  return (
    <div className="mb-8">
      {/* Breadcrumb */}
      <nav
        className="flex items-center gap-1.5 text-sm mb-8"
        style={{ color: "var(--cl-text-muted)" }}
      >
        <Link to="/" className="transition-colors hover:underline" style={{ color: "var(--cl-text-secondary)" }}>
          Agents
        </Link>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <Link
          to={`/agent/${encodeURIComponent(session.agentId)}`}
          className="transition-colors hover:underline"
          style={{ color: "var(--cl-text-secondary)" }}
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

      {/* AI summary — on-demand */}
      {summary ? (
        isDegradedNoKey ? (
          // Issue #76 degraded state. Same warn color the AgentCardCompact
          // chip uses so both surfaces read as one "no provider key" signal.
          // ⚠ glyph in front replaces the routine "AI" badge — this text was
          // NOT LLM-generated and must not be advertised as such.
          <div
            data-cl-session-summary-degraded
            className="flex items-baseline gap-2 mb-4"
            style={{ color: "var(--cl-risk-medium)" }}
            role="status"
          >
            <span aria-hidden="true" style={{ fontSize: "12px" }}>
              ⚠
            </span>
            <p
              className="text-sm"
              style={{ color: "var(--cl-risk-medium)", lineHeight: 1.6 }}
            >
              {summary}
            </p>
          </div>
        ) : (
          <div className="flex items-baseline gap-2 mb-4">
            <p
              className="text-sm italic"
              style={{ color: "var(--cl-text-secondary)", lineHeight: 1.6 }}
            >
              &ldquo;{summary}&rdquo;
            </p>
            {isLlmGenerated && (
              <span
                className="label-mono shrink-0"
                style={{ fontSize: "10px", color: "var(--cl-text-muted)" }}
              >
                AI
              </span>
            )}
          </div>
        )
      ) : (
        <button
          onClick={generate}
          disabled={summaryLoading}
          className="flex items-center gap-1.5 text-xs font-mono mb-4 transition-colors"
          style={{
            color: summaryLoading ? "var(--cl-text-muted)" : "var(--cl-accent)",
            cursor: summaryLoading ? "default" : "pointer",
            background: "none",
            border: "none",
            padding: 0,
          }}
        >
          {summaryLoading ? (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: "spin 1s linear infinite" }}>
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
              Summarizing...
            </>
          ) : (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" />
                <path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.855z" />
              </svg>
              Summarize session
            </>
          )}
        </button>
      )}

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
