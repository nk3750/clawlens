import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import type { AgentInfo, StatsResponse } from "../lib/types";
import { relTime, riskTierFromScore } from "../lib/utils";
import AgentCard from "../components/AgentCard";
import RiskBadge from "../components/RiskBadge";

export default function Overview() {
  const [view, setView] = useState<"grid" | "list">("grid");
  const navigate = useNavigate();
  const { data: agents, loading: agentsLoading } =
    useApi<AgentInfo[]>("api/agents");
  const { data: stats } = useApi<StatsResponse>("api/stats");

  return (
    <div>
      {/* Stats bar */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatCard
            label="Allowed"
            value={stats.allowed}
            color="text-emerald-400"
            index={0}
          />
          <StatCard
            label="Blocked"
            value={stats.blocked}
            color="text-red-400"
            index={1}
          />
          <StatCard
            label="Approved"
            value={stats.approved}
            color="text-amber-400"
            index={2}
          />
          <StatCard
            label="Avg Risk"
            value={stats.avgRiskScore}
            color="text-secondary"
            index={3}
          />
        </div>
      )}

      {/* Risk breakdown mini-bar */}
      {stats && stats.riskBreakdown && (
        <div className="flex items-center gap-3 mb-6 px-1">
          <span className="text-[11px] text-muted uppercase tracking-wider">
            Risk
          </span>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-risk-low">
              {stats.riskBreakdown.low} low
            </span>
            <span className="text-muted">{"\u00b7"}</span>
            <span className="text-risk-medium">
              {stats.riskBreakdown.medium} med
            </span>
            <span className="text-muted">{"\u00b7"}</span>
            <span className="text-risk-high">
              {stats.riskBreakdown.high} high
            </span>
            <span className="text-muted">{"\u00b7"}</span>
            <span className="text-risk-critical">
              {stats.riskBreakdown.critical} crit
            </span>
          </div>
          {stats.activeAgents > 0 && (
            <span className="ml-auto text-xs text-status-active">
              {stats.activeAgents} active agent
              {stats.activeAgents !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      )}

      {/* Header with view toggle */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="font-display font-bold text-primary text-lg">
          Agents
        </h1>
        <div className="flex items-center gap-1 bg-surface rounded-lg p-0.5 border border-border">
          <ViewToggle
            active={view === "grid"}
            onClick={() => setView("grid")}
            label="Grid"
          />
          <ViewToggle
            active={view === "list"}
            onClick={() => setView("list")}
            label="List"
          />
        </div>
      </div>

      {/* Loading state */}
      {agentsLoading && (
        <div className="text-center py-16 text-muted">
          <div className="inline-block w-5 h-5 border-2 border-border border-t-accent rounded-full animate-spin mb-3" />
          <p className="text-sm">Loading agents...</p>
        </div>
      )}

      {/* Empty state */}
      {!agentsLoading && agents && agents.length === 0 && (
        <div className="text-center py-16 text-muted">
          <div className="text-3xl mb-3 opacity-40">
            {"\u{1f441}"}
          </div>
          <p className="text-sm font-display font-medium text-secondary mb-1">
            No agents detected
          </p>
          <p className="text-xs">
            Agent activity will appear once ClawLens starts processing tool
            calls.
          </p>
        </div>
      )}

      {/* Grid view */}
      {agents && agents.length > 0 && view === "grid" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {agents.map((agent, i) => (
            <AgentCard key={agent.id} agent={agent} index={i} />
          ))}
        </div>
      )}

      {/* List view */}
      {agents && agents.length > 0 && view === "list" && (
        <div className="bg-card border border-border rounded-xl overflow-hidden animate-fade-in">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wider font-display">
                  Agent
                </th>
                <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wider font-display">
                  Status
                </th>
                <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wider font-display">
                  Risk
                </th>
                <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wider font-display hidden md:table-cell">
                  Calls Today
                </th>
                <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wider font-display hidden md:table-cell">
                  Last Active
                </th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => {
                const riskTier = agent.peakRiskScore
                  ? riskTierFromScore(agent.peakRiskScore)
                  : undefined;
                return (
                  <tr
                    key={agent.id}
                    className="border-b border-border/50 hover:bg-elevated/30 cursor-pointer transition-colors"
                    onClick={() =>
                      navigate(
                        `/agent/${encodeURIComponent(agent.id)}`,
                      )
                    }
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-2 h-2 rounded-full shrink-0 ${
                            agent.status === "active"
                              ? "bg-status-active"
                              : "bg-status-idle"
                          }`}
                        />
                        <span className="font-display font-medium text-primary">
                          {agent.name}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-xs ${
                          agent.status === "active"
                            ? "text-status-active"
                            : "text-muted"
                        }`}
                      >
                        {agent.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <RiskBadge
                        score={
                          agent.peakRiskScore || undefined
                        }
                        tier={riskTier}
                      />
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-muted font-mono">
                      {agent.todayToolCalls}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-muted text-xs">
                      {agent.lastActiveTimestamp
                        ? relTime(agent.lastActiveTimestamp)
                        : "\u2014"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
  index,
}: {
  label: string;
  value: number;
  color: string;
  index: number;
}) {
  return (
    <div
      className="bg-card border border-border rounded-xl px-4 py-3 animate-fade-in"
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <div className={`text-2xl font-bold font-mono tabular-nums ${color}`}>
        {value}
      </div>
      <div className="text-[11px] text-muted uppercase tracking-wider mt-0.5 font-display">
        {label}
      </div>
    </div>
  );
}

function ViewToggle({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
        active
          ? "bg-elevated text-primary"
          : "text-muted hover:text-secondary"
      }`}
    >
      {label}
    </button>
  );
}
