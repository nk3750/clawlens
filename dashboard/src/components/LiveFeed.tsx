import { useState, useCallback, useRef, useMemo } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { useSSE } from "../hooks/useSSE";
import type { EntryResponse } from "../lib/types";
import {
  DEFAULT_AGENT_ID,
  deriveTags,
  relTime,
  riskColorRaw,
  riskLeftBorder,
  riskTierFromScore,
} from "../lib/utils";
import { describeEntry } from "../lib/groupEntries";
import GradientAvatar from "./GradientAvatar";

const MAX_ITEMS = 8;

/** Tags that warrant the danger-color palette — everything else stays
 *  muted-neutral. Keeps the chip row reading as a quiet annotation except
 *  when something actually needs attention. */
const DANGER_TAG_PATTERNS = [
  /^destruct/i,
  /^block/i,
  /delete/i,
  /^permission/i,
  /credential/i,
  /exfiltrat/i,
  /^persistence/i,
];

function tagIsDanger(tag: string): boolean {
  return DANGER_TAG_PATTERNS.some((re) => re.test(tag));
}

export default function LiveFeed() {
  const { data: initialEntries } = useApi<EntryResponse[]>(
    "api/entries?limit=8",
  );
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
      setSseEntries((prev) => [entry, ...prev].slice(0, MAX_ITEMS));

      // Flash animation for new entry — matches the .entry-flash timing (1.5s).
      const id = entry.toolCallId ?? entry.timestamp;
      setNewIds((prev) => new Set(prev).add(id));
      setTimeout(() => {
        setNewIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, 1500);
    }, []),
  );

  // Merge SSE entries (newest) with initial API entries (backfill), deduped.
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
    <section data-cl-live-feed>
      <div className="flex items-center gap-2 mb-2">
        <span className="label-mono" style={{ color: "var(--cl-text-muted)" }}>
          LIVE
        </span>
        <span
          className="inline-block w-1.5 h-1.5 rounded-full"
          style={{
            backgroundColor: "var(--cl-risk-low)",
            animation: "cl-pulse 2s ease-in-out infinite",
          }}
        />
        <span
          className="label-mono"
          style={{ color: "var(--cl-text-muted)", marginLeft: "auto" }}
        >
          {entries.length} event{entries.length === 1 ? "" : "s"}
        </span>
      </div>
      <div
        ref={listRef}
        data-cl-live-feed-list
        className="cl-card overflow-hidden"
        style={{ padding: 0 }}
      >
        {entries.map((entry, i) => {
          const id = entry.toolCallId ?? entry.timestamp;
          const isNew = newIds.has(id);
          const agentId = entry.agentId || DEFAULT_AGENT_ID;
          const tier = riskTierFromScore(entry.riskScore ?? 0);
          const tierColor = riskColorRaw(tier);
          const isLast = i === entries.length - 1;
          const tags = deriveTags({
            toolName: entry.toolName,
            execCategory: entry.execCategory,
            riskTags: entry.riskTags,
          });
          const shadow = riskLeftBorder(entry.riskScore);

          return (
            <Link
              key={`${id}-${i}`}
              to={
                entry.sessionKey
                  ? `/session/${encodeURIComponent(entry.sessionKey)}`
                  : `/agent/${encodeURIComponent(agentId)}`
              }
              data-cl-live-feed-row={id}
              className={`entry-hover ${isNew ? "entry-flash" : ""}`.trim()}
              style={{
                display: "grid",
                gridTemplateColumns:
                  "auto auto auto minmax(0, 1fr) auto auto",
                alignItems: "center",
                gap: 8,
                padding: "8px 12px",
                borderBottom: isLast
                  ? undefined
                  : "1px solid var(--cl-border-subtle)",
                textDecoration: "none",
                color: "var(--cl-text-primary)",
                boxShadow: shadow,
              }}
            >
              {/* Timestamp — mono 11 */}
              <span
                className="font-mono tabular-nums"
                style={{
                  fontSize: 11,
                  color: "var(--cl-text-subdued)",
                }}
              >
                {fmtTimeOfDay(entry.timestamp)}
              </span>

              {/* Tier dot */}
              <span
                className="inline-block rounded-full shrink-0"
                style={{
                  width: 6,
                  height: 6,
                  backgroundColor: tierColor,
                }}
                aria-hidden="true"
              />

              {/* Agent avatar */}
              <GradientAvatar agentId={agentId} size="xs" />

              {/* Agent + tool description. `describeEntry` includes the tool
                  args in-line so we don't need a separate column for them. */}
              <span
                className="truncate flex items-baseline gap-1.5"
                style={{
                  color: "var(--cl-text-secondary)",
                  fontFamily: "var(--cl-font-sans)",
                  fontSize: 13,
                  fontWeight: 510,
                }}
              >
                <span style={{ color: "var(--cl-text-primary)" }}>
                  {agentId}
                </span>
                <span
                  className="truncate"
                  style={{
                    fontFamily: "var(--cl-font-mono)",
                    fontWeight: 400,
                    fontSize: 12,
                    color: "var(--cl-text-secondary)",
                  }}
                >
                  {describeEntry(entry)}
                </span>
              </span>

              {/* Tag chips */}
              <span className="flex items-center gap-1 shrink-0">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="cl-pill"
                    style={
                      tagIsDanger(tag)
                        ? { color: "var(--cl-risk-high)" }
                        : undefined
                    }
                  >
                    {tag}
                  </span>
                ))}
              </span>

              {/* Relative time — mono 11 */}
              <span
                className="font-mono tabular-nums shrink-0"
                style={{
                  fontSize: 11,
                  color: "var(--cl-text-subdued)",
                }}
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

function fmtTimeOfDay(iso: string): string {
  const d = new Date(iso);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}
