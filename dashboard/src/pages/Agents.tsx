import { useApi } from "../hooks/useApi";
import type { AgentInfo, StatsResponse } from "../lib/types";
import RiskPulse from "../components/RiskPulse";
import AgentCard from "../components/AgentCard";
import HexField from "../components/HexField";

const NODE_POS = [
  { x: 0.25, y: 0.3 },
  { x: 0.75, y: 0.3 },
  { x: 0.25, y: 0.7 },
  { x: 0.75, y: 0.7 },
];

export default function Agents() {
  const { data: agents, loading } = useApi<AgentInfo[]>("api/agents");
  const { data: stats } = useApi<StatsResponse>("api/stats");

  return (
    <>
      {stats && <RiskPulse stats={stats} />}

      {/* ── Agent constellation ── */}
      <section className="relative" style={{ marginTop: "clamp(24px, 3vw, 48px)" }}>
        <div className="flex items-center gap-3 mb-8">
          <span className="label-mono" style={{ color: "var(--cl-text-muted)" }}>
            Your agents
          </span>
          {agents && (
            <span className="font-mono text-[10px]" style={{ color: "var(--cl-text-muted)", opacity: 0.4 }}>
              {agents.length}
            </span>
          )}
        </div>

        {/* Hex background layer */}
        {agents && agents.length > 0 && (
          <div
            className="absolute pointer-events-none overflow-hidden"
            style={{ inset: "30px -60px 0 -60px", zIndex: 0 }}
          >
            <HexField nodes={NODE_POS.slice(0, agents.length)} />
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6" style={{ position: "relative", zIndex: 1 }}>
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="rounded-xl h-72"
                style={{
                  backgroundColor: "var(--cl-surface)",
                  border: "1px solid var(--cl-border-subtle)",
                  opacity: 0.3,
                }}
              />
            ))}
          </div>
        )}

        {/* Empty */}
        {!loading && agents && agents.length === 0 && (
          <div className="text-center py-20" style={{ position: "relative", zIndex: 1 }}>
            <p className="font-display text-lg" style={{ color: "var(--cl-text-muted)" }}>
              No agents yet
            </p>
          </div>
        )}

        {/* Agent cards — staggered diamond on desktop */}
        {agents && agents.length > 0 && (
          <div
            className="grid grid-cols-1 md:grid-cols-2 stagger"
            style={{
              position: "relative",
              zIndex: 1,
              gap: "clamp(20px, 2.5vw, 32px)",
            }}
          >
            {agents.map((a, i) => (
              <div
                key={a.id}
                style={{
                  transform: `translateY(${i % 2 !== 0 ? 28 : 0}px)`,
                }}
              >
                <AgentCard agent={a} />
              </div>
            ))}
          </div>
        )}

        {/* Compensate for stagger offset */}
        <div className="hidden md:block" style={{ height: 28 }} />
      </section>

      <div style={{ height: "clamp(40px, 6vw, 80px)" }} />
    </>
  );
}
