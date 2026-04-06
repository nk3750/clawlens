import { useApi } from "../hooks/useApi";
import type { AgentInfo, StatsResponse } from "../lib/types";
import RiskPulse from "../components/RiskPulse";
import HexConstellation from "../components/HexConstellation";

export default function Agents() {
  const { data: agents, loading } = useApi<AgentInfo[]>("api/agents");
  const { data: stats } = useApi<StatsResponse>("api/stats");

  return (
    <>
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

        {loading && (
          <div
            className="flex items-center justify-center"
            style={{ height: 400, color: "var(--cl-text-muted)" }}
          >
            <span className="font-mono text-[12px]">Scanning for agents...</span>
          </div>
        )}

        {!loading && agents && agents.length === 0 && (
          <div
            className="flex flex-col items-center justify-center text-center"
            style={{ height: 400 }}
          >
            <p className="font-display text-lg" style={{ color: "var(--cl-text-muted)" }}>
              No agents yet
            </p>
            <p className="text-[13px] mt-2 max-w-xs" style={{ color: "var(--cl-text-muted)", opacity: 0.5 }}>
              ClawLens is watching. Activity will appear here once agents start.
            </p>
          </div>
        )}

        {agents && agents.length > 0 && (
          <HexConstellation agents={agents} />
        )}
      </section>
    </>
  );
}
