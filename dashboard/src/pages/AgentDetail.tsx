import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { useSSE } from "../hooks/useSSE";
import type { AgentDetailResponse, EntryResponse, RiskTrendPoint } from "../lib/types";
import { relTime, formatDuration, mergeLiveEntries } from "../lib/utils";
import AgentHeader from "../components/AgentHeader";
import RiskPanel from "../components/RiskPanel";
import ActivityProfile from "../components/ActivityProfile";
import ActivityStream from "../components/ActivityStream";
import SessionCard from "../components/SessionCard";
import AttentionBanner from "../components/AttentionBanner";
import ErrorCard from "../components/ErrorCard";
import { AgentDetailSkeleton } from "../components/Skeleton";

export default function AgentDetail() {
  const { agentId } = useParams<{ agentId: string }>();
  const { data, loading, error, refetch } = useApi<AgentDetailResponse>(
    `api/agent/${encodeURIComponent(agentId || "")}`,
  );

  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [liveEntries, setLiveEntries] = useState<EntryResponse[]>([]);

  // SSE for live streaming — always call the hook (Rules of Hooks),
  // but the callback only processes events when the agent is active
  useSSE<EntryResponse>("api/stream", (entry) => {
    if (data?.agent.status === "active" && entry.agentId === data.agent.id) {
      setLiveEntries((prev) => [entry, ...prev].slice(0, 50));
    }
  });

  if (loading && !data) {
    return <AgentDetailSkeleton />;
  }

  if (error && !data) {
    return <ErrorCard message={error} onRetry={refetch} />;
  }

  if (!data) {
    return (
      <div className="text-center py-20" style={{ color: "var(--cl-text-muted)" }}>
        Agent not found
        <br />
        <Link
          to="/"
          className="text-sm mt-2 inline-block"
          style={{ color: "var(--cl-accent)" }}
        >
          &larr; Back to Agents
        </Link>
      </div>
    );
  }

  const { agent, currentSessionActivity, recentActivity, sessions, riskTrend } = data;

  // Compute top risks from recent activity
  const topRisks = recentActivity
    .filter((e) => e.riskScore != null && e.riskScore >= 25)
    .sort((a, b) => (b.riskScore ?? 0) - (a.riskScore ?? 0))
    .slice(0, 5);

  // Session stats for header
  const sessionEntries = currentSessionActivity.length > 0
    ? currentSessionActivity
    : recentActivity;
  const scores = sessionEntries
    .filter((e) => e.riskScore != null)
    .map((e) => e.riskScore!);
  const avgRisk = scores.length > 0
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : agent.avgRiskScore;
  const peakRisk = scores.length > 0
    ? Math.max(...scores)
    : agent.peakRiskScore;

  // Merge live + initial entries for active agents
  const streamEntries = agent.status === "active"
    ? mergeLiveEntries(liveEntries, currentSessionActivity)
    : recentActivity;

  // Dynamic section label
  const isActive = agent.status === "active";
  const lastSession = sessions[0];
  const showSection = isActive || !!lastSession;

  // Sparkline dot click → scroll to matching entry
  const handleDotClick = (point: RiskTrendPoint, _index: number) => {
    // Find entry by matching timestamp+toolName in the stream
    const match = streamEntries.find(
      (e) => e.timestamp === point.timestamp && e.toolName === point.toolName,
    );
    if (match?.toolCallId) {
      document
        .getElementById(`entry-${match.toolCallId}`)
        ?.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <div className="page-enter stagger">
      {/* Attention banner */}
      {agent.needsAttention && agent.attentionReason && !bannerDismissed && (
        <AttentionBanner
          reason={agent.attentionReason}
          onDismiss={() => setBannerDismissed(true)}
        />
      )}

      {/* Hero header */}
      <AgentHeader
        agent={agent}
        todayActions={agent.todayToolCalls}
        avgRisk={avgRisk}
        peakRisk={peakRisk}
        totalSessions={data.totalSessions}
      />

      {/* Two-column layout: Risk Drivers (left) + Activity Profile (right) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-10 mb-10">
        {/* Left: Risk drivers */}
        <div className="cl-card p-6">
          <h2
            className="label-mono mb-5"
            style={{ color: "var(--cl-text-muted)" }}
          >
            RISK DRIVERS
          </h2>
          <RiskPanel
            riskTrend={riskTrend}
            topRisks={topRisks}
            onDotClick={handleDotClick}
          />
        </div>

        {/* Right: Activity profile */}
        <div className="cl-card p-6">
          <h2
            className="label-mono mb-5"
            style={{ color: "var(--cl-text-muted)" }}
          >
            TODAY'S ACTIVITY
          </h2>
          <ActivityProfile
            breakdown={agent.todayActivityBreakdown}
            sessionActions={agent.currentSession?.toolCallCount}
            todayActions={agent.todayToolCalls}
          />
        </div>
      </div>

      <div className="cl-divider mb-10" />

      {/* Activity stream — dynamic section */}
      {showSection && (
        <section className="mb-10">
          {isActive ? (
            /* Active agent: CURRENT SESSION + LIVE */
            <>
              <div className="flex items-center gap-2.5 mb-5">
                <h2
                  className="label-mono"
                  style={{ color: "var(--cl-text-muted)" }}
                >
                  CURRENT SESSION
                </h2>
                <span className="flex items-center gap-1.5">
                  <svg width="8" height="8" viewBox="0 0 8 8">
                    <circle cx="4" cy="4" r="3" fill="var(--cl-risk-low)">
                      <animate
                        attributeName="opacity"
                        values="1;0.35;1"
                        dur="2s"
                        repeatCount="indefinite"
                      />
                    </circle>
                  </svg>
                  <span
                    className="label-mono"
                    style={{ color: "var(--cl-risk-low)", fontSize: "10px" }}
                  >
                    LIVE
                  </span>
                </span>
              </div>
              <ActivityStream entries={streamEntries} />
            </>
          ) : lastSession ? (
            /* Idle agent: LAST ACTIVE SESSION */
            <>
              <div className="flex items-center gap-2.5 mb-2">
                <h2
                  className="label-mono"
                  style={{ color: "var(--cl-text-muted)" }}
                >
                  LAST ACTIVE SESSION
                </h2>
                <span
                  className="label-mono"
                  style={{ color: "var(--cl-text-muted)", fontSize: "10px" }}
                >
                  ended {relTime(lastSession.endTime ?? lastSession.startTime)}
                </span>
              </div>
              <div
                className="flex items-center gap-3 mb-5 font-mono text-xs"
                style={{ color: "var(--cl-text-secondary)" }}
              >
                <span>{formatDuration(lastSession.duration)}</span>
                <span style={{ color: "var(--cl-text-muted)" }}>&middot;</span>
                <span>{lastSession.toolCallCount} actions</span>
                <span style={{ color: "var(--cl-text-muted)" }}>&middot;</span>
                <Link
                  to={`/session/${encodeURIComponent(lastSession.sessionKey)}`}
                  className="transition-colors"
                  style={{ color: "var(--cl-accent)" }}
                >
                  View full session &rarr;
                </Link>
              </div>
              <ActivityStream entries={recentActivity} />
            </>
          ) : null}
        </section>
      )}

      {/* Past sessions */}
      {sessions.length > 0 && (
        <section>
          <div className="cl-divider mb-10" />
          <h2
            className="label-mono mb-5"
            style={{ color: "var(--cl-text-muted)" }}
          >
            PAST SESSIONS ({sessions.length})
          </h2>
          <div className="flex gap-4 overflow-x-auto pb-4 -mx-2 px-2">
            {sessions.map((s) => (
              <SessionCard key={s.sessionKey} session={s} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
