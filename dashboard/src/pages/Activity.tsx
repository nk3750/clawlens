import { useState, useCallback, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { useSSE } from "../hooks/useSSE";
import type { EntryResponse, StatsResponse, AgentInfo } from "../lib/types";
import { relTime, riskTierFromScore, riskColorRaw, CATEGORY_META } from "../lib/utils";
import GradientAvatar from "../components/GradientAvatar";
import DecisionBadge from "../components/DecisionBadge";
import FilterBar, { type FilterState } from "../components/FilterBar";
import LiveIndicator from "../components/LiveIndicator";

const EMPTY_FILTERS: FilterState = {
  agent: "",
  category: "",
  riskTier: "",
  decision: "",
  since: "",
};

function buildQueryString(filters: FilterState, limit: number, offset: number): string {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  if (filters.agent) params.set("agent", filters.agent);
  if (filters.category) params.set("category", filters.category);
  if (filters.riskTier) params.set("riskTier", filters.riskTier);
  if (filters.decision) params.set("decision", filters.decision);
  if (filters.since) params.set("since", filters.since);
  return params.toString();
}

/** Check if an SSE entry matches current filter state (client-side) */
function matchesFilters(entry: EntryResponse, filters: FilterState): boolean {
  if (filters.agent && entry.agentId !== filters.agent) return false;
  if (filters.category && entry.category !== filters.category) return false;
  if (filters.riskTier && entry.riskTier !== filters.riskTier) return false;
  if (filters.decision) {
    const eff = entry.effectiveDecision;
    if (filters.decision === "block" && eff !== "block" && eff !== "denied") return false;
    if (filters.decision === "allow" && eff !== "allow") return false;
    if (filters.decision !== "block" && filters.decision !== "allow" && eff !== filters.decision) return false;
  }
  return true;
}

function describeEntry(e: EntryResponse): string {
  const p = e.params;
  switch (e.toolName) {
    case "read": return p.path ? `Read ${p.path}` : "Read file";
    case "write": return p.path ? `Wrote ${p.path}` : "Wrote file";
    case "edit": return p.path ? `Edited ${p.path}` : "Edited file";
    case "exec": return p.command ? `Ran \`${String(p.command).slice(0, 40)}\`` : "Executed command";
    case "message": return p.subject ? `Sent "${p.subject}"` : "Sent message";
    case "fetch_url": return p.url ? `Fetched ${String(p.url).slice(0, 40)}` : "Fetched URL";
    case "grep": return p.pattern ? `Searched "${p.pattern}"` : "Searched";
    case "glob": return p.pattern ? `Scanned ${p.pattern}` : "Scanned files";
    default: return e.toolName;
  }
}

export default function Activity() {
  const [entries, setEntries] = useState<EntryResponse[]>([]);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pulseKey, setPulseKey] = useState(0);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const { data: stats } = useApi<StatsResponse>("api/stats");
  const { data: agents } = useApi<AgentInfo[]>("api/agents");

  // Build query from filters
  const query = buildQueryString(filters, 50, 0);
  const { data: initialEntries, loading } = useApi<EntryResponse[]>(
    `api/entries?${query}`,
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

      // Client-side filter check
      if (!matchesFilters(entry, filtersRef.current)) return;

      const id = entry.toolCallId || entry.timestamp;
      setNewIds((prev) => new Set(prev).add(id));
      setEntries((prev) => [entry, ...prev]);
      setPulseKey((k) => k + 1);

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
      const q = buildQueryString(filters, 50, offset);
      const res = await fetch(`/plugins/clawlens/api/entries?${q}`);
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

  const handleFiltersChange = (next: FilterState) => {
    setFilters(next);
    setOffset(0);
    setHasMore(true);
  };

  const hasActiveFilters = filters.agent || filters.category || filters.riskTier || filters.decision || filters.since;

  return (
    <div className="stagger">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <h1
            className="font-display font-bold"
            style={{ fontSize: "var(--text-heading)", color: "var(--cl-text-primary)" }}
          >
            Activity
          </h1>
          <LiveIndicator pulseKey={pulseKey} />
        </div>
        {stats && (
          <span className="font-mono text-sm" style={{ color: "var(--cl-text-secondary)" }}>
            {stats.total} actions today
          </span>
        )}
      </div>

      {/* Filter bar */}
      <div className="mb-6">
        <FilterBar
          filters={filters}
          onChange={handleFiltersChange}
          agents={agents ?? undefined}
        />
      </div>

      <div className="cl-divider mb-6" />

      {/* Loading */}
      {loading && entries.length === 0 && (
        <div className="text-center py-20">
          <div
            className="inline-block w-6 h-6 rounded-full border-2 animate-spin"
            style={{
              borderColor: "var(--cl-border-default)",
              borderTopColor: "var(--cl-accent)",
            }}
          />
        </div>
      )}

      {/* Empty */}
      {!loading && entries.length === 0 && (
        <p
          className="text-center py-20"
          style={{ color: "var(--cl-text-muted)", fontSize: "var(--text-subhead)" }}
        >
          {hasActiveFilters ? "No results match your filters" : "No activity yet"}
        </p>
      )}

      {/* Feed */}
      {entries.length > 0 && (
        <div
          className="rounded-xl border overflow-hidden"
          style={{
            backgroundColor: "var(--cl-surface)",
            borderColor: "var(--cl-border-subtle)",
          }}
        >
          {entries.map((entry, i) => {
            const id = entry.toolCallId || entry.timestamp;
            const isNew = newIds.has(id);
            const tier = entry.riskScore != null ? riskTierFromScore(entry.riskScore) : null;
            const dotColor = tier ? riskColorRaw(tier) : null;
            const meta = CATEGORY_META[entry.category];
            const showBadge = entry.effectiveDecision && entry.effectiveDecision !== "allow";

            return (
              <div
                key={`${id}-${i}`}
                className={`flex items-center gap-3 px-4 py-3 transition-all ${isNew ? "entry-flash" : ""}`}
                style={{
                  borderBottom: i < entries.length - 1 ? "1px solid var(--cl-border-subtle)" : undefined,
                  animation: isNew
                    ? "slide-in 0.4s var(--cl-spring) both"
                    : undefined,
                }}
              >
                {/* Agent avatar */}
                {entry.agentId && (
                  <Link to={`/agent/${encodeURIComponent(entry.agentId)}`} className="shrink-0">
                    <GradientAvatar agentId={entry.agentId} size="sm" />
                  </Link>
                )}

                {/* Category icon */}
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={meta?.color ?? "var(--cl-text-muted)"}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="shrink-0"
                >
                  <path d={meta?.iconPath ?? ""} />
                </svg>

                {/* Content */}
                <div className="min-w-0 flex-1">
                  {entry.agentId && (
                    <Link
                      to={`/agent/${encodeURIComponent(entry.agentId)}`}
                      className="text-xs font-semibold mr-2 transition-colors"
                      style={{ color: "var(--cl-text-primary)" }}
                    >
                      {entry.agentId}
                    </Link>
                  )}
                  <span className="text-sm" style={{ color: "var(--cl-text-secondary)" }}>
                    {describeEntry(entry)}
                  </span>
                </div>

                {/* Risk dot */}
                {entry.riskScore != null && dotColor && (
                  <span className="flex items-center gap-1 shrink-0">
                    <span
                      className="inline-block w-1.5 h-1.5 rounded-full"
                      style={{
                        backgroundColor: dotColor,
                        boxShadow: tier !== "low" ? `0 0 5px ${dotColor}50` : undefined,
                      }}
                    />
                    <span className="font-mono text-xs" style={{ color: "var(--cl-text-secondary)" }}>
                      {entry.riskScore}
                    </span>
                  </span>
                )}

                {/* Decision badge */}
                {showBadge && (
                  <span className="shrink-0">
                    <DecisionBadge decision={entry.effectiveDecision} />
                  </span>
                )}

                {/* Timestamp */}
                <span className="font-mono text-xs shrink-0" style={{ color: "var(--cl-text-secondary)" }}>
                  {relTime(entry.timestamp)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Load more */}
      {hasMore && entries.length > 0 && (
        <button
          onClick={loadMore}
          disabled={loadingMore}
          className="w-full mt-4 py-3 text-sm transition-all disabled:opacity-50 rounded-xl border cursor-pointer"
          style={{
            color: "var(--cl-text-muted)",
            borderColor: "var(--cl-border-subtle)",
            backgroundColor: "transparent",
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
