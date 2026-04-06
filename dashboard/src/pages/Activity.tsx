import { useState, useCallback, useEffect } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { useSSE } from "../hooks/useSSE";
import type { EntryResponse, StatsResponse } from "../lib/types";
import { relTime } from "../lib/utils";
import GradientAvatar from "../components/GradientAvatar";
import DecisionBadge from "../components/DecisionBadge";

export default function Activity() {
  const [entries, setEntries] = useState<EntryResponse[]>([]);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

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
      const res = await fetch(`/plugins/clawlens/api/entries?limit=50&offset=${offset}`);
      const more: EntryResponse[] = await res.json();
      setEntries((prev) => [...prev, ...more]);
      setOffset((prev) => prev + more.length);
      setHasMore(more.length >= 50);
    } catch { /* ignore */ } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1
              className="font-display font-bold text-2xl"
              style={{ color: "var(--cl-text-primary)" }}
            >
              Activity
            </h1>
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full" style={{ backgroundColor: "rgba(74, 222, 128, 0.08)" }}>
              <span
                className="inline-block w-1.5 h-1.5 rounded-full animate-pulse"
                style={{ backgroundColor: "var(--cl-status-active)" }}
              />
              <span className="label-mono" style={{ color: "var(--cl-status-active)" }}>
                LIVE
              </span>
            </div>
          </div>
        </div>
        {stats && (
          <span className="font-mono text-sm" style={{ color: "var(--cl-text-secondary)" }}>
            {stats.total} actions today
          </span>
        )}
      </div>

      {/* Loading */}
      {loading && entries.length === 0 && (
        <div className="text-center py-20" style={{ color: "var(--cl-text-muted)" }}>
          Loading...
        </div>
      )}

      {/* Empty */}
      {!loading && entries.length === 0 && (
        <p
          className="text-center py-20"
          style={{ color: "var(--cl-text-muted)" }}
        >
          No activity yet
        </p>
      )}

      {/* Feed */}
      {entries.length > 0 && (
        <div
          className="rounded-xl border divide-y overflow-hidden"
          style={{
            backgroundColor: "var(--cl-surface)",
            borderColor: "var(--cl-border-subtle)",
          }}
        >
          {entries.map((entry, i) => (
            <div
              key={entry.toolCallId || `${entry.timestamp}-${i}`}
              className={`flex items-center gap-3 px-4 py-3 ${
                newIds.has(entry.toolCallId || entry.timestamp) ? "entry-flash" : ""
              }`}
            >
              {entry.agentId && (
                <Link to={`/agent/${encodeURIComponent(entry.agentId)}`}>
                  <GradientAvatar agentId={entry.agentId} size="sm" />
                </Link>
              )}
              <div className="min-w-0 flex-1">
                {entry.agentId && (
                  <Link
                    to={`/agent/${encodeURIComponent(entry.agentId)}`}
                    className="text-xs font-medium mr-2"
                    style={{ color: "var(--cl-text-primary)" }}
                  >
                    {entry.agentId}
                  </Link>
                )}
                <span className="text-sm" style={{ color: "var(--cl-text-secondary)" }}>
                  {entry.toolName}
                </span>
              </div>
              {entry.effectiveDecision && entry.effectiveDecision !== "allow" && (
                <DecisionBadge decision={entry.effectiveDecision} />
              )}
              {entry.riskScore != null && (
                <span className="font-mono text-xs" style={{ color: "var(--cl-text-secondary)" }}>
                  {entry.riskScore}
                </span>
              )}
              <span className="font-mono text-xs shrink-0" style={{ color: "var(--cl-text-secondary)" }}>
                {relTime(entry.timestamp)}
              </span>
            </div>
          ))}
        </div>
      )}

      {hasMore && entries.length > 0 && (
        <button
          onClick={loadMore}
          disabled={loadingMore}
          className="w-full mt-4 py-3 text-sm transition-colors disabled:opacity-50 rounded-xl border"
          style={{
            color: "var(--cl-text-muted)",
            borderColor: "var(--cl-border-subtle)",
          }}
        >
          {loadingMore ? "Loading..." : "Load more"}
        </button>
      )}
    </div>
  );
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
