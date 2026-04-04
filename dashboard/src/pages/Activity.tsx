import { useState, useCallback, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { useSSE } from "../hooks/useSSE";
import type { EntryResponse, AgentInfo, StatsResponse } from "../lib/types";
import EntryRow from "../components/EntryRow";
import Filters from "../components/Filters";

export default function Activity() {
  const [searchParams] = useSearchParams();
  const initialAgent = searchParams.get("agent") || "";

  const [entries, setEntries] = useState<EntryResponse[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState(initialAgent);
  const [selectedTool, setSelectedTool] = useState("");
  const [selectedRisk, setSelectedRisk] = useState("");
  const [selectedTime, setSelectedTime] = useState("24h");

  const { data: agents } = useApi<AgentInfo[]>("api/agents");
  const { data: stats } = useApi<StatsResponse>("api/stats");
  const { data: initialEntries, loading } = useApi<EntryResponse[]>(
    "api/entries?limit=50&offset=0",
  );

  useEffect(() => {
    if (initialEntries) {
      setEntries(initialEntries);
      setHasMore(initialEntries.length >= 50);
      setOffset(initialEntries.length);
    }
  }, [initialEntries]);

  // SSE for live updates
  useSSE<EntryResponse>(
    "api/stream",
    useCallback((raw: EntryResponse) => {
      const entry: EntryResponse = {
        ...raw,
        effectiveDecision:
          raw.effectiveDecision || computeDecision(raw),
      };
      setEntries((prev) => [entry, ...prev]);
    }, []),
  );

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const res = await fetch(
        `/plugins/clawlens/api/entries?limit=50&offset=${offset}`,
      );
      const more: EntryResponse[] = await res.json();
      setEntries((prev) => [...prev, ...more]);
      setOffset((prev) => prev + more.length);
      setHasMore(more.length >= 50);
    } catch {
      // ignore
    } finally {
      setLoadingMore(false);
    }
  };

  // Client-side filtering
  const filtered = entries.filter((e) => {
    if (selectedAgent && e.agentId !== selectedAgent) return false;
    if (selectedTool && e.toolName !== selectedTool) return false;
    if (selectedRisk && e.riskTier !== selectedRisk) return false;
    if (selectedTime) {
      const cutoff = getTimeCutoff(selectedTime);
      if (cutoff && new Date(e.timestamp).getTime() < cutoff) return false;
    }
    return true;
  });

  const tools = [...new Set(entries.map((e) => e.toolName))].sort();

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h1 className="font-display font-bold text-primary text-lg">
            Live Activity
          </h1>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-risk-low animate-pulse" />
            <span className="text-[11px] text-muted">streaming</span>
          </div>
        </div>
        {stats && (
          <div className="flex items-center gap-4 text-xs text-muted">
            <span>
              Today:{" "}
              <span className="text-secondary font-mono">
                {stats.total}
              </span>{" "}
              events
            </span>
            {stats.activeAgents > 0 && (
              <span className="text-status-active">
                {stats.activeAgents} active
              </span>
            )}
          </div>
        )}
      </div>

      <Filters
        agents={agents || []}
        selectedAgent={selectedAgent}
        onAgentChange={setSelectedAgent}
        selectedTool={selectedTool}
        onToolChange={setSelectedTool}
        selectedRisk={selectedRisk}
        onRiskChange={setSelectedRisk}
        selectedTime={selectedTime}
        onTimeChange={setSelectedTime}
        tools={tools}
      />

      {loading && entries.length === 0 && (
        <div className="text-center py-16 text-muted">
          <div className="inline-block w-5 h-5 border-2 border-border border-t-accent rounded-full animate-spin mb-3" />
          <p className="text-sm">Loading activity...</p>
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="text-center py-16 text-muted">
          <div className="text-3xl mb-3 opacity-40">
            {"\u{1f4e1}"}
          </div>
          <p className="text-sm font-display font-medium text-secondary mb-1">
            No activity
          </p>
          <p className="text-xs">Waiting for agent events...</p>
        </div>
      )}

      <div className="space-y-1.5">
        {filtered.map((entry, i) => (
          <EntryRow
            key={entry.toolCallId || `${entry.timestamp}-${i}`}
            entry={entry}
            index={i}
          />
        ))}
      </div>

      {hasMore && filtered.length > 0 && (
        <button
          onClick={loadMore}
          disabled={loadingMore}
          className="w-full mt-4 py-3 bg-card border border-border rounded-lg text-sm text-muted hover:text-secondary hover:border-border-hover transition-colors disabled:opacity-50"
        >
          {loadingMore ? "Loading..." : "Load more"}
        </button>
      )}
    </div>
  );
}

function getTimeCutoff(range: string): number | null {
  const now = Date.now();
  switch (range) {
    case "1h":
      return now - 60 * 60 * 1000;
    case "6h":
      return now - 6 * 60 * 60 * 1000;
    case "24h":
      return now - 24 * 60 * 60 * 1000;
    case "7d":
      return now - 7 * 24 * 60 * 60 * 1000;
    default:
      return null;
  }
}

function computeDecision(entry: EntryResponse): string {
  if (entry.userResponse === "approved") return "approved";
  if (entry.userResponse === "denied") return "denied";
  if (entry.userResponse === "timeout") return "timeout";
  if (entry.decision === "allow") return "allow";
  if (entry.decision === "block") return "block";
  if (entry.decision === "approval_required") return "pending";
  if (entry.executionResult) return entry.executionResult;
  return "unknown";
}
