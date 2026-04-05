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
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState(initialAgent);
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
        effectiveDecision: raw.effectiveDecision || computeDecision(raw),
      };
      const id = entry.toolCallId || entry.timestamp;
      setNewIds((prev) => new Set(prev).add(id));
      setEntries((prev) => [entry, ...prev]);
      // Clear "new" highlight after 2 seconds
      setTimeout(() => {
        setNewIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, 2000);
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
      /* ignore */
    } finally {
      setLoadingMore(false);
    }
  };

  // Client-side filtering
  const filtered = entries.filter((e) => {
    if (selectedAgent && e.agentId !== selectedAgent) return false;
    if (selectedRisk && e.riskTier !== selectedRisk) return false;
    if (selectedTime) {
      const cutoff = getTimeCutoff(selectedTime);
      if (cutoff && new Date(e.timestamp).getTime() < cutoff) return false;
    }
    return true;
  });

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 animate-fade-in">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="font-display font-bold text-primary text-2xl">
              Activity
            </h1>
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-status-active/10">
              <div className="w-1.5 h-1.5 rounded-full bg-status-active animate-pulse" />
              <span className="text-[11px] text-status-active font-medium">live</span>
            </div>
          </div>
          <p className="text-sm text-muted">
            Real-time feed of agent actions across all sessions
          </p>
        </div>
        {stats && (
          <div className="text-right hidden sm:block">
            <div className="text-2xl font-bold font-mono text-primary tabular-nums">
              {stats.total}
            </div>
            <div className="text-[11px] text-muted">actions today</div>
          </div>
        )}
      </div>

      {/* Filters */}
      <Filters
        agents={agents || []}
        selectedAgent={selectedAgent}
        onAgentChange={setSelectedAgent}
        selectedRisk={selectedRisk}
        onRiskChange={setSelectedRisk}
        selectedTime={selectedTime}
        onTimeChange={setSelectedTime}
      />

      {/* Loading */}
      {loading && entries.length === 0 && (
        <div className="text-center py-20 text-muted">
          <div className="inline-block w-6 h-6 border-2 border-border border-t-accent rounded-full animate-spin mb-4" />
          <p className="text-sm font-display">Loading activity\u2026</p>
        </div>
      )}

      {/* Empty */}
      {!loading && filtered.length === 0 && (
        <div className="text-center py-20 text-muted animate-fade-in">
          <div className="w-16 h-16 rounded-2xl bg-surface border border-border flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-muted/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <p className="font-display font-semibold text-secondary text-base mb-1">Waiting for actions</p>
          <p className="text-xs max-w-xs mx-auto">
            New actions will appear here in real-time as your agents work.
          </p>
        </div>
      )}

      {/* Feed */}
      {filtered.length > 0 && (
        <div className="bg-card/50 border border-border/50 rounded-2xl divide-y divide-border/30 overflow-hidden">
          {filtered.map((entry, i) => (
            <EntryRow
              key={entry.toolCallId || `${entry.timestamp}-${i}`}
              entry={entry}
              index={i}
              isNew={newIds.has(entry.toolCallId || entry.timestamp)}
            />
          ))}
        </div>
      )}

      {/* Load more */}
      {hasMore && filtered.length > 0 && (
        <button
          onClick={loadMore}
          disabled={loadingMore}
          className="w-full mt-4 py-3 bg-card border border-border rounded-xl text-sm text-muted hover:text-secondary hover:border-border-hover transition-all duration-200 disabled:opacity-50"
        >
          {loadingMore ? "Loading\u2026" : "Load older actions"}
        </button>
      )}
    </div>
  );
}

function getTimeCutoff(range: string): number | null {
  const now = Date.now();
  switch (range) {
    case "1h": return now - 60 * 60 * 1000;
    case "6h": return now - 6 * 60 * 60 * 1000;
    case "24h": return now - 24 * 60 * 60 * 1000;
    case "7d": return now - 7 * 24 * 60 * 60 * 1000;
    default: return null;
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
