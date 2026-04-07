import { useParams, Link } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import type { SessionDetailResponse } from "../lib/types";
import { groupEntries } from "../lib/groupEntries";
import SessionHeader from "../components/SessionHeader";
import SessionTimeline from "../components/SessionTimeline";
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
  const sorted = [...entries].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const groups = groupEntries(sorted);

  return (
    <div className="page-enter stagger">
      {/* Lean header: identity + summary + stat strip */}
      <SessionHeader session={session} />

      {/* Unified timeline */}
      <SessionTimeline
        groups={groups}
        sessionStart={session.startTime}
        sessionEnd={session.endTime}
        sessionDuration={session.duration}
      />
    </div>
  );
}
