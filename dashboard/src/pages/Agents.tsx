import { useApi } from "../hooks/useApi";
import type { AgentInfo, StatsResponse } from "../lib/types";
import RiskPulse from "../components/RiskPulse";
import AgentCard from "../components/AgentCard";

export default function Agents() {
  const { data: agents, loading } = useApi<AgentInfo[]>("api/agents");
  const { data: stats } = useApi<StatsResponse>("api/stats");

  return (
    <>
      {/* Risk Pulse strip */}
      {stats && <RiskPulse stats={stats} />}

      {/* Agent cards */}
      <section className="mt-16">
        <h2
          className="label-mono mb-8"
          style={{ color: "var(--cl-text-muted)" }}
        >
          YOUR AGENTS
        </h2>

        {/* Loading */}
        {loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="rounded-xl border p-7 animate-pulse"
                style={{
                  backgroundColor: "var(--cl-surface)",
                  borderColor: "var(--cl-border-subtle)",
                  height: 280,
                }}
              />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && agents && agents.length === 0 && (
          <p
            className="text-center py-16"
            style={{ color: "var(--cl-text-muted)" }}
          >
            No agents yet. ClawLens is watching &mdash; activity will appear
            here once agents start running.
          </p>
        )}

        {/* Agent grid */}
        {agents && agents.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 stagger">
            {agents.map((a) => (
              <AgentCard key={a.id} agent={a} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
