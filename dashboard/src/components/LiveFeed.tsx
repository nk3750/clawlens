import { useState, useCallback, useRef, useMemo } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { useSSE } from "../hooks/useSSE";
import type { EntryResponse, ActivityCategory } from "../lib/types";
import { CATEGORY_META, DEFAULT_AGENT_ID, riskColorRaw, riskTierFromScore, relTime } from "../lib/utils";
import { describeEntry } from "../lib/groupEntries";
import GradientAvatar from "./GradientAvatar";

const MAX_ITEMS = 8;

export default function LiveFeed() {
  const { data: initialEntries } = useApi<EntryResponse[]>("api/entries?limit=8");
  const [sseEntries, setSseEntries] = useState<EntryResponse[]>([]);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);

  useSSE<EntryResponse>(
    "api/stream",
    useCallback((entry: EntryResponse) => {
      // Skip result-only emits (after_tool_call, eval, approval-resolution).
      // Only decision rows belong in the action feed; everything else is a
      // post-fact annotation on a row already shown.
      if (!entry.decision) return;
      setSseEntries((prev) => {
        const next = [entry, ...prev].slice(0, MAX_ITEMS);
        return next;
      });

      // Flash animation for new entry
      const id = entry.toolCallId ?? entry.timestamp;
      setNewIds((prev) => new Set(prev).add(id));
      setTimeout(() => {
        setNewIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, 2000);
    }, []),
  );

  // Merge SSE entries (newest) with initial API entries (backfill), deduped
  const entries = useMemo(() => {
    if (sseEntries.length === 0 && !initialEntries) return [];
    const seen = new Set<string>();
    const merged: EntryResponse[] = [];
    for (const e of sseEntries) {
      const key = e.toolCallId ?? e.timestamp;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(e);
      }
    }
    for (const e of initialEntries ?? []) {
      if (merged.length >= MAX_ITEMS) break;
      const key = e.toolCallId ?? e.timestamp;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(e);
      }
    }
    return merged.slice(0, MAX_ITEMS);
  }, [sseEntries, initialEntries]);

  if (entries.length === 0 && !initialEntries) return null;

  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
        <span
          className="label-mono"
          style={{ color: "var(--cl-text-muted)" }}
        >
          LIVE
        </span>
        <span
          className="inline-block w-1.5 h-1.5 rounded-full"
          style={{
            backgroundColor: "var(--cl-risk-low)",
            boxShadow: "0 0 4px rgba(74, 222, 128, 0.5)",
            animation: "pulse 2s ease-in-out infinite",
          }}
        />
      </div>
      <div
        ref={listRef}
        className="rounded-xl overflow-hidden"
        style={{
          border: "1px solid var(--cl-border-subtle)",
          backgroundColor: "var(--cl-surface)",
        }}
      >
        {entries.map((entry, i) => {
          const id = entry.toolCallId ?? entry.timestamp;
          const isNew = newIds.has(id);
          const agentId = entry.agentId || DEFAULT_AGENT_ID;
          const category = (entry.category ?? "exploring") as ActivityCategory;
          const meta = CATEGORY_META[category];
          const tier = riskTierFromScore(entry.riskScore ?? 0);
          const isLast = i === entries.length - 1;

          return (
            <Link
              key={`${id}-${i}`}
              to={entry.sessionKey
                ? `/session/${encodeURIComponent(entry.sessionKey)}`
                : `/agent/${encodeURIComponent(agentId)}`}
              className="flex items-center gap-2.5 px-3 py-2 transition-all"
              style={{
                borderBottom: isLast ? undefined : "1px solid var(--cl-border-subtle)",
                textDecoration: "none",
                backgroundColor: isNew ? "rgba(212, 165, 116, 0.06)" : "transparent",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.backgroundColor = "var(--cl-elevated)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.backgroundColor = isNew
                  ? "rgba(212, 165, 116, 0.06)"
                  : "transparent";
              }}
            >
              {/* Agent avatar */}
              <GradientAvatar agentId={agentId} size="xs" />

              {/* Category icon */}
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke={meta.color}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="shrink-0"
              >
                <path d={meta.iconPath} />
              </svg>

              {/* Description */}
              <span
                className="font-sans text-[11px] truncate flex-1 min-w-0"
                style={{ color: "var(--cl-text-secondary)" }}
              >
                <span style={{ color: "var(--cl-text-primary)", fontWeight: 500 }}>
                  {agentId}
                </span>
                {" "}
                {describeEntry(entry)}
              </span>

              {/* Risk dot */}
              {(entry.riskScore ?? 0) > 0 && (
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: riskColorRaw(tier) }}
                />
              )}

              {/* Timestamp */}
              <span
                className="font-mono text-[10px] shrink-0"
                style={{ color: "var(--cl-text-muted)" }}
              >
                {relTime(entry.timestamp)}
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
