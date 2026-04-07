import { useParams, Link } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import type { AgentDetailResponse, AgentInfo } from "../lib/types";
import AgentHeader from "../components/AgentHeader";
import RiskPanel from "../components/RiskPanel";
import ActivityProfile from "../components/ActivityProfile";
import ActivityStream from "../components/ActivityStream";
import SessionCard from "../components/SessionCard";
import ErrorCard from "../components/ErrorCard";
import { AgentDetailSkeleton } from "../components/Skeleton";

export default function AgentDetail() {
  const { agentId } = useParams<{ agentId: string }>();
  const { data, loading, error, refetch } = useApi<AgentDetailResponse>(
    `api/agent/${encodeURIComponent(agentId || "")}`,
  );
  const { data: allAgents } = useApi<AgentInfo[]>("api/agents");

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

  // Session stats from current session entries
  const sessionEntries = currentSessionActivity.length > 0
    ? currentSessionActivity
    : recentActivity;
  const scores = sessionEntries
    .filter((e) => e.riskScore != null)
    .map((e) => e.riskScore!);
  const sessionStats = scores.length > 0
    ? {
        avg: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
        peak: Math.max(...scores),
        count: sessionEntries.length,
      }
    : undefined;

  return (
    <div className="page-enter stagger">
      {/* Hero header */}
      <AgentHeader agent={agent} />

      {/* Two-column layout: Risk Panel (left) + Activity Profile (right) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-10 mb-10">
        {/* Left: Risk intelligence */}
        <div className="cl-card p-6">
          <h2
            className="label-mono mb-5"
            style={{ color: "var(--cl-text-muted)" }}
          >
            RISK INTELLIGENCE
          </h2>
          <RiskPanel
            agent={agent}
            riskTrend={riskTrend}
            allAgents={allAgents ?? undefined}
            sessionStats={sessionStats}
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

      {/* Activity stream — current session only */}
      <section className="mb-10">
        <h2
          className="label-mono mb-5"
          style={{ color: "var(--cl-text-muted)" }}
        >
          CURRENT SESSION
        </h2>
        {agent.currentSession && currentSessionActivity.length > 0 ? (
          <ActivityStream entries={currentSessionActivity} />
        ) : (
          <p className="text-sm py-6" style={{ color: "var(--cl-text-muted)" }}>
            No active session
          </p>
        )}
      </section>

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
