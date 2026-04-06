import { useParams, Link } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import type { SessionDetailResponse } from "../lib/types";
import SessionHeader from "../components/SessionHeader";
import RiskTimeline from "../components/RiskTimeline";
import ToolCallTimeline from "../components/ToolCallTimeline";
import ErrorCard from "../components/ErrorCard";
import { SessionDetailSkeleton } from "../components/Skeleton";

export default function SessionDetail() {
  const { sessionKey } = useParams<{ sessionKey: string }>();
  const { data, loading, error, refetch } = useApi<SessionDetailResponse>(
    `api/session/${encodeURIComponent(sessionKey || "")}`,
  );

  if (loading && !data) {
    return <SessionDetailSkeleton />;
  }

  if (error && !data) {
    return <ErrorCard message={error} onRetry={refetch} />;
  }

  if (!data) {
    return (
      <div className="text-center py-20" style={{ color: "var(--cl-text-muted)" }}>
        Session not found
        <br />
        <Link to="/" className="text-sm mt-2 inline-block" style={{ color: "var(--cl-accent)" }}>
          &larr; Back to Agents
        </Link>
      </div>
    );
  }

  const { session, entries } = data;

  return (
    <div className="page-enter stagger">
      <SessionHeader session={session} />

      {/* Risk Timeline chart — the session risk hero */}
      <section className="mb-10">
        <h2 className="label-mono mb-5" style={{ color: "var(--cl-text-muted)" }}>
          RISK TIMELINE
        </h2>
        <div
          className="cl-card p-5 overflow-hidden"
        >
          <RiskTimeline
            entries={entries}
            sessionStart={session.startTime}
            sessionEnd={session.endTime}
          />
        </div>
      </section>

      <div className="cl-divider mb-10" />

      {/* Tool call timeline — granular forensics view */}
      <section>
        <h2 className="label-mono mb-5" style={{ color: "var(--cl-text-muted)" }}>
          TOOL CALLS ({entries.length})
        </h2>
        <ToolCallTimeline entries={entries} sessionStart={session.startTime} />
      </section>
    </div>
  );
}
