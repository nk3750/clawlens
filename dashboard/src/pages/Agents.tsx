import { useApi } from "../hooks/useApi";
import type { AgentInfo, StatsResponse } from "../lib/types";
import RiskPulse from "../components/RiskPulse";
import HexConstellation from "../components/HexConstellation";
import ErrorCard from "../components/ErrorCard";
import { ConstellationSkeleton } from "../components/Skeleton";

export default function Agents() {
  const { data: agents, loading, error, refetch } = useApi<AgentInfo[]>("api/agents");
  const { data: stats } = useApi<StatsResponse>("api/stats");

  return (
    <div className="page-enter">
      {/* Fleet risk posture hero */}
      {stats && <RiskPulse stats={stats} />}

      {/* Agent constellation */}
      <section style={{ marginTop: "clamp(16px, 2vw, 32px)" }}>
        <div className="flex items-center gap-3 mb-6">
          <span className="label-mono" style={{ color: "var(--cl-text-muted)" }}>
            Your agents
          </span>
          {agents && (
            <span className="font-mono text-[10px]" style={{ color: "var(--cl-text-muted)", opacity: 0.4 }}>
              {agents.length}
            </span>
          )}
        </div>

        {/* Loading skeleton */}
        {loading && !agents && (
          <ConstellationSkeleton />
        )}

        {/* Error state */}
        {error && !agents && (
          <ErrorCard message={error} onRetry={refetch} />
        )}

        {/* Empty state */}
        {!loading && !error && agents && agents.length === 0 && (
          <div
            className="flex flex-col items-center justify-center text-center"
            style={{ height: 400 }}
          >
            <p
              className="font-display"
              style={{ color: "var(--cl-text-muted)", fontSize: "var(--text-subhead)" }}
            >
              No agents yet
            </p>
            <p className="text-sm mt-3 max-w-sm" style={{ color: "var(--cl-text-muted)", opacity: 0.6 }}>
              ClawLens is watching — activity will appear here once agents start.
            </p>
          </div>
        )}

        {agents && agents.length > 0 && (
          <HexConstellation agents={agents} />
        )}
      </section>
    </div>
  );
}
