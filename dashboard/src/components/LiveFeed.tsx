import { useState, useCallback, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { useSSE } from "../hooks/useSSE";
import type { EntryResponse } from "../lib/types";
import { riskTierFromScore, riskColorRaw, riskLeftBorder } from "../lib/utils";
import { describeEntry } from "../lib/groupEntries";
import GradientAvatar from "./GradientAvatar";
import LiveIndicator from "./LiveIndicator";

interface Props {
  isToday: boolean;
  selectedDate: string | null;
}

const MAX_VISIBLE = 30;

export default function LiveFeed({ isToday, selectedDate }: Props) {
  const [entries, setEntries] = useState<EntryResponse[]>([]);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [pulseKey, setPulseKey] = useState(0);

  // Initial entries
  const apiPath = useMemo(() => {
    if (isToday) return "api/entries?limit=30";
    return `api/entries?limit=50&date=${selectedDate}`;
  }, [isToday, selectedDate]);

  const { data: initialEntries, loading } = useApi<EntryResponse[]>(apiPath);

  useEffect(() => {
    if (initialEntries) {
      setEntries(initialEntries);
    }
  }, [initialEntries]);

  // SSE for live updates (only when viewing today)
  useSSE<EntryResponse>(
    isToday ? "api/stream" : "",
    useCallback(
      (raw: EntryResponse) => {
        if (!isToday) return;
        const entry: EntryResponse = {
          ...raw,
          effectiveDecision: raw.effectiveDecision || computeDecision(raw),
        };

        const id = entry.toolCallId || entry.timestamp;
        setNewIds((prev) => new Set(prev).add(id));
        setEntries((prev) => [entry, ...prev].slice(0, MAX_VISIBLE));
        setPulseKey((k) => k + 1);

        setTimeout(() => {
          setNewIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        }, 2000);
      },
      [isToday],
    ),
  );

  const visible = entries
    .filter((e) => e.riskScore != null && e.agentId && !("refToolCallId" in e))
    .slice(0, MAX_VISIBLE);

  return (
    <div className="mt-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="label-mono" style={{ color: "var(--cl-text-muted)" }}>
            {isToday ? "ACTIVITY" : "ACTIVITY LOG"}
          </span>
          {isToday && <LiveIndicator pulseKey={pulseKey} />}
        </div>
      </div>

      {/* Feed */}
      {loading && entries.length === 0 && (
        <p className="text-sm py-8 text-center" style={{ color: "var(--cl-text-muted)" }}>
          Loading...
        </p>
      )}

      {!loading && entries.length === 0 && (
        <p className="text-sm py-8 text-center" style={{ color: "var(--cl-text-muted)" }}>
          No activity {isToday ? "yet" : "on this day"}
        </p>
      )}

      {visible.length > 0 && (
        <div
          className="rounded-xl border overflow-hidden"
          style={{
            backgroundColor: "var(--cl-surface)",
            borderColor: "var(--cl-border-subtle)",
          }}
        >
          {visible.map((entry, i) => {
            const id = entry.toolCallId || entry.timestamp;
            const isNew = newIds.has(id);
            const tier = entry.riskScore != null ? riskTierFromScore(entry.riskScore) : null;
            const tierColor = tier ? riskColorRaw(tier) : null;
            const guardrailBlocked =
              entry.guardrailMatch && entry.effectiveDecision === "block";
            const guardrailApproval =
              entry.guardrailMatch &&
              (entry.effectiveDecision === "pending" ||
                entry.effectiveDecision === "approved" ||
                entry.effectiveDecision === "denied");
            const time = new Date(entry.timestamp).toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            });

            return (
              <Link
                key={`${id}-${i}`}
                to={entry.sessionKey ? `/session/${encodeURIComponent(entry.sessionKey)}` : "#"}
                className={`flex items-center gap-2.5 px-3 py-2 transition-all ${isNew ? "entry-flash" : ""}`}
                style={{
                  borderBottom:
                    i < visible.length - 1 ? "1px solid var(--cl-border-subtle)" : undefined,
                  boxShadow: riskLeftBorder(entry.riskScore),
                  backgroundColor: guardrailBlocked
                    ? "rgba(248, 113, 113, 0.04)"
                    : guardrailApproval
                      ? "rgba(251, 191, 36, 0.04)"
                      : undefined,
                  animation: isNew ? "slide-in 0.4s var(--cl-spring) both" : undefined,
                  textDecoration: "none",
                }}
              >
                {/* Time */}
                <span
                  className="font-mono text-[11px] shrink-0 w-10"
                  style={{ color: "var(--cl-text-muted)" }}
                >
                  {time}
                </span>

                {/* Agent avatar */}
                {entry.agentId && (
                  <GradientAvatar agentId={entry.agentId} size="sm" />
                )}

                {/* Agent name */}
                {entry.agentId && (
                  <span
                    className="text-xs font-semibold shrink-0 w-28 truncate"
                    style={{ color: "var(--cl-text-primary)" }}
                  >
                    {entry.agentId}
                  </span>
                )}

                {/* Guardrail shield */}
                {guardrailBlocked && (
                  <span
                    className="flex items-center gap-0.5 shrink-0 label-mono"
                    style={{ color: riskColorRaw("high") }}
                  >
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    </svg>
                    BLK
                  </span>
                )}
                {guardrailApproval && (
                  <span
                    className="flex items-center gap-0.5 shrink-0 label-mono"
                    style={{ color: "#fbbf24" }}
                  >
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    </svg>
                    APR
                  </span>
                )}

                {/* Description */}
                <span
                  className="text-xs truncate flex-1 min-w-0"
                  style={{ color: "var(--cl-text-secondary)" }}
                >
                  {describeEntry(entry)}
                </span>

                {/* Risk score + tier */}
                {entry.riskScore != null && tierColor && tier && (
                  <span className="flex items-center gap-1 shrink-0">
                    <span className="font-mono text-[11px]" style={{ color: "var(--cl-text-secondary)" }}>
                      {entry.riskScore}
                    </span>
                    <span className="label-mono" style={{ color: tierColor }}>
                      {tier === "critical" ? "CRIT" : tier === "medium" ? "MED" : tier.toUpperCase()}
                    </span>
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}

      {/* View all link */}
      {entries.length > 0 && (
        <div className="mt-3 text-center">
          <Link
            to="/activity"
            className="text-xs transition-colors"
            style={{ color: "var(--cl-text-muted)" }}
          >
            View all activity &rarr;
          </Link>
        </div>
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
