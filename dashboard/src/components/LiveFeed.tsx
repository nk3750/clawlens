import { useCallback, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { useSSE } from "../hooks/useSSE";
import {
  formatEventTarget,
  toolNamespace,
  verbFor,
} from "../lib/eventFormat";
import type { EntryResponse } from "../lib/types";
import {
  DEFAULT_AGENT_ID,
  deriveTags,
  relTimeCompact,
  riskColorRaw,
  riskLeftBorder,
  riskTierFromScore,
} from "../lib/utils";

// Polish-2 §1.4 — progressive disclosure via "View more".
//   INITIAL_LIMIT = initial fetch count (rows visible on mount)
//   PAGE_STEP     = rows appended per "View more" click
//   CAP           = hard ceiling on in-memory row count (3 clicks land here)
const INITIAL_LIMIT = 8;
const PAGE_STEP = 8;
const CAP = 24;

/** Tags that warrant the danger-color palette — everything else stays
 *  muted-neutral. Keeps the chip row reading as a quiet annotation except
 *  when something actually needs attention.
 *
 *  Decision chips (spec §4, §5): `blocked` matches `^block/i`; `timeout` is
 *  added here so timed-out approvals also read red. `pending` is a neutral
 *  state — deliberately NOT matched here. */
const DANGER_TAG_PATTERNS = [
  /^destruct/i,
  /^block/i,
  /^timeout$/i,
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
  const [pageSize, setPageSize] = useState(INITIAL_LIMIT);
  const { data: initialEntries } = useApi<EntryResponse[]>(
    `api/entries?limit=${pageSize}`,
  );
  const [sseEntries, setSseEntries] = useState<EntryResponse[]>([]);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);

  const loadMore = useCallback(() => {
    setPageSize((prev) => Math.min(prev + PAGE_STEP, CAP));
  }, []);

  useSSE<EntryResponse>(
    "api/stream",
    useCallback((entry: EntryResponse) => {
      // Skip result-only emits (after_tool_call, eval, approval-resolution).
      // Only decision rows belong in the action feed.
      if (!entry.decision) return;
      // SSE slice cap is the hard CAP — not pageSize — so arrivals keep
      // filling the top even before the user clicks View more.
      setSseEntries((prev) => [entry, ...prev].slice(0, CAP));

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
      if (merged.length >= CAP) break;
      const key = e.toolCallId ?? e.timestamp;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(e);
      }
    }
    return merged.slice(0, CAP);
  }, [sseEntries, initialEntries]);

  return (
    <section
      data-cl-live-feed
      style={{
        height: "100%",
        maxHeight: 580,
        minHeight: 0,
      }}
    >
      <div
        ref={listRef}
        data-cl-live-feed-list
        className="cl-card"
        style={{
          padding: 0,
          height: "100%",
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          data-cl-live-feed-header
          className="flex items-center gap-2"
          style={{
            padding: "10px 14px",
            borderBottom: "1px solid var(--cl-border-subtle)",
          }}
        >
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
        </div>
        <div
          data-cl-live-feed-scroll
          style={{ flex: 1, overflowY: "auto", minHeight: 0 }}
        >
          {entries.length === 0 ? (
            <div
              data-cl-live-feed-empty
              className="flex items-center justify-center"
              style={{
                padding: "24px 14px",
                minHeight: 80,
                color: "var(--cl-text-muted)",
                fontFamily: "var(--cl-font-sans)",
                fontSize: 12,
              }}
            >
              No recent activity
            </div>
          ) : (
            entries.map((entry, i) => {
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
              effectiveDecision: entry.effectiveDecision,
            });
            const shadow = riskLeftBorder(entry.riskScore);
            const verb = verbFor(entry);
            const ns = toolNamespace(entry);
            const target = formatEventTarget(entry);

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
                title={entry.timestamp}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  padding: "8px 14px",
                  borderBottom: isLast
                    ? undefined
                    : "1px solid var(--cl-border-subtle)",
                  textDecoration: "none",
                  color: "var(--cl-text-primary)",
                  boxShadow: shadow,
                }}
              >
                {/* Line 1 — tier dot, agent, verb, namespace, chips, rel-time */}
                <span
                  className="flex items-center"
                  style={{ gap: 8, minWidth: 0 }}
                >
                  <span
                    className="inline-block rounded-full shrink-0"
                    style={{
                      width: 6,
                      height: 6,
                      backgroundColor: tierColor,
                      boxShadow: `0 0 4px ${tierColor}4d`,
                    }}
                    aria-hidden="true"
                  />
                  <span
                    style={{
                      fontFamily: "var(--cl-font-sans)",
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--cl-text-primary)",
                    }}
                  >
                    {agentId}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--cl-font-sans)",
                      fontSize: 13,
                      fontWeight: 400,
                      color: "var(--cl-text-secondary)",
                    }}
                  >
                    {verb}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--cl-font-mono)",
                      fontSize: 12,
                      fontWeight: 500,
                      color: "var(--cl-text-primary)",
                    }}
                  >
                    {ns}
                  </span>
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
                  <span
                    className="font-mono tabular-nums shrink-0"
                    style={{
                      marginLeft: "auto",
                      fontSize: 11,
                      color: "var(--cl-text-muted)",
                    }}
                  >
                    {relTimeCompact(entry.timestamp)}
                  </span>
                </span>
                {/* Line 2 — target (path / command / URL / query). Skip entirely
                    when formatEventTarget returns empty so memoryless rows
                    don't grow a phantom blank line. */}
                {target !== "" && (
                  <span
                    data-cl-live-feed-target
                    className="block truncate"
                    style={{
                      fontFamily: "var(--cl-font-mono)",
                      fontSize: 12,
                      color: "var(--cl-text-muted)",
                      paddingLeft: 14,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {target}
                  </span>
                )}
              </Link>
            );
          })
          )}
        </div>
        {entries.length > 0 && pageSize < CAP && (
          <button
            type="button"
            data-cl-live-feed-viewmore
            onClick={loadMore}
            className="flex items-center justify-center"
            style={{
              padding: "10px 14px",
              fontFamily: "var(--cl-font-mono)",
              fontSize: 11,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "var(--cl-text-muted)",
              border: 0,
              borderTop: "1px solid var(--cl-border-subtle)",
              background: "var(--cl-surface)",
              cursor: "pointer",
              width: "100%",
            }}
          >
            View more
          </button>
        )}
        {entries.length > 0 && pageSize >= CAP && (
          <Link
            data-cl-live-feed-viewall
            to="/activity"
            className="flex items-center justify-center"
            style={{
              padding: "10px 14px",
              fontFamily: "var(--cl-font-mono)",
              fontSize: 11,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "var(--cl-text-muted)",
              textDecoration: "none",
              borderTop: "1px solid var(--cl-border-subtle)",
              background: "var(--cl-surface)",
            }}
          >
            View all in Activity →
          </Link>
        )}
      </div>
    </section>
  );
}
