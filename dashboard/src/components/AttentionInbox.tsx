import { useCallback, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useKeyboardShortcut } from "../hooks/useKeyboardShortcut";
import type { AttentionAgent, AttentionItem, AttentionResponse } from "../lib/types";
import { riskColorRaw } from "../lib/utils";
import AgentAttentionRow from "./attention/AgentAttentionRow";
import ApprovalCard from "./attention/ApprovalCard";
import BlockedRow from "./attention/BlockedRow";
import HighRiskRow from "./attention/HighRiskRow";

const INITIAL_VISIBLE_NON_HERO = 3;

type NonHeroItem =
  | { kind: "blocked"; item: AttentionItem }
  | { kind: "timeout"; item: AttentionItem }
  | { kind: "agent"; item: AttentionAgent }
  | { kind: "highrisk"; item: AttentionItem };

function nonHeroKey(v: NonHeroItem): string {
  if (v.kind === "agent") return `agent:${v.item.agentId}:${v.item.triggerAt}`;
  return `${v.kind}:${v.item.toolCallId}`;
}

interface Props {
  /** Owned by `Agents.tsx` — sourced from useLiveApi<AttentionResponse>. */
  data: AttentionResponse | null;
  /** Owned by `Agents.tsx` — refetch the attention payload after a successful ack. */
  refetch: () => void;
}

export default function AttentionInbox({ data, refetch }: Props) {
  const [expanded, setExpanded] = useState(false);
  /** Keys locally removed (optimistic) so the row disappears before the refetch completes. */
  const [optimisticRemoved, setOptimisticRemoved] = useState<Set<string>>(new Set());
  const navigate = useNavigate();
  const containerRef = useRef<HTMLElement | null>(null);

  const nonHero = useMemo<NonHeroItem[]>(() => {
    if (!data) return [];
    return [
      ...data.blocked.map((item) => ({
        kind: item.kind === "timeout" ? ("timeout" as const) : ("blocked" as const),
        item,
      })),
      ...data.agentAttention.map((item) => ({ kind: "agent" as const, item })),
      ...data.highRisk.map((item) => ({ kind: "highrisk" as const, item })),
    ];
  }, [data]);

  const visibleNonHero = useMemo(
    () => nonHero.filter((v) => !optimisticRemoved.has(nonHeroKey(v))),
    [nonHero, optimisticRemoved],
  );
  const visiblePending = useMemo(() => {
    if (!data) return [];
    return data.pending.filter(
      (p) => !optimisticRemoved.has(nonHeroKey({ kind: "blocked", item: p })),
    );
  }, [data, optimisticRemoved]);

  // First visible non-hero item is "topmost" for keyboard shortcut targeting.
  const topmost = visibleNonHero[0];

  const onOptimisticRemove = useCallback((key: string) => {
    setOptimisticRemoved((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    return () => {
      setOptimisticRemoved((prev) => {
        if (!prev.has(key)) return prev;
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    };
  }, []);
  const onPersisted = useCallback(() => {
    refetch();
  }, [refetch]);

  // Keyboard shortcuts — gated to elements inside `[data-attention-inbox]`.
  useKeyboardShortcut(
    "a",
    () => {
      if (!topmost) return;
      if (topmost.kind === "agent") {
        const key = nonHeroKey(topmost);
        const revert = onOptimisticRemove(key);
        fetch("/plugins/clawlens/api/attention/ack", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scope: {
              kind: "agent",
              agentId: topmost.item.agentId,
              upToIso: topmost.item.triggerAt,
            },
          }),
        })
          .then((r) => {
            if (!r.ok) throw new Error();
            refetch();
          })
          .catch(revert);
      } else {
        const key = nonHeroKey(topmost);
        const revert = onOptimisticRemove(key);
        fetch("/plugins/clawlens/api/attention/ack", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scope: { kind: "entry", toolCallId: topmost.item.toolCallId },
          }),
        })
          .then((r) => {
            if (!r.ok) throw new Error();
            refetch();
          })
          .catch(revert);
      }
    },
    "[data-attention-inbox]",
    !!topmost,
  );

  useKeyboardShortcut(
    "v",
    () => {
      if (!topmost) return;
      if (topmost.kind === "agent") {
        navigate(`/agent/${encodeURIComponent(topmost.item.agentId)}`);
      } else if (topmost.item.sessionKey) {
        navigate(`/session/${encodeURIComponent(topmost.item.sessionKey)}`, {
          state: { highlightToolCallId: topmost.item.toolCallId },
        });
      }
    },
    "[data-attention-inbox]",
    !!topmost,
  );

  if (!data) return null;
  const total = visiblePending.length + visibleNonHero.length;
  if (total === 0) return null;

  const visibleList = expanded ? visibleNonHero : visibleNonHero.slice(0, INITIAL_VISIBLE_NON_HERO);
  const hiddenCount = visibleNonHero.length - visibleList.length;

  const headerColor = visiblePending.length > 0 ? riskColorRaw("high") : riskColorRaw("medium");

  return (
    <section
      ref={containerRef}
      data-attention-inbox
      data-cl-attention-anchor
      tabIndex={0}
      aria-label="Attention inbox"
      className="flex flex-col outline-none"
      style={{ gap: 10 }}
    >
      <div className="flex items-center gap-2">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke={headerColor}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z M12 9v4 M12 17h.01" />
        </svg>
        <span
          className="font-sans text-xs font-medium tracking-wide uppercase"
          style={{ color: headerColor }}
        >
          {total} {total === 1 ? "item needs" : "items need"} attention
        </span>
      </div>

      {visiblePending.map((p, i) => (
        <ApprovalCard key={`t1-${p.toolCallId}`} item={p} pulsing={i === 0} />
      ))}

      {visibleList.length > 0 && (
        <div
          className="overflow-hidden"
          style={{
            border: "1px solid var(--cl-border-default)",
            borderRadius: 12,
          }}
        >
          {visibleList.map((v, i) => {
            const isLast = i === visibleList.length - 1 && hiddenCount === 0;
            const isTopmost = topmost && nonHeroKey(v) === nonHeroKey(topmost);
            const key = nonHeroKey(v);
            const removeFn = () => onOptimisticRemove(key);

            if (v.kind === "agent") {
              return (
                <AgentAttentionRow
                  key={key}
                  item={v.item}
                  isLast={isLast}
                  onOptimisticRemove={removeFn}
                  onPersisted={onPersisted}
                  showShortcutHint
                  isTopmost={isTopmost}
                />
              );
            }
            if (v.kind === "highrisk") {
              return (
                <HighRiskRow
                  key={key}
                  item={v.item}
                  isLast={isLast}
                  onOptimisticRemove={removeFn}
                  onPersisted={onPersisted}
                  showShortcutHint
                  isTopmost={isTopmost}
                />
              );
            }
            return (
              <BlockedRow
                key={key}
                item={v.item}
                isLast={isLast}
                onOptimisticRemove={removeFn}
                onPersisted={onPersisted}
                showShortcutHint
                isTopmost={isTopmost}
              />
            );
          })}
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="w-full text-center font-sans text-xs transition-colors"
              style={{
                color: "var(--cl-text-muted)",
                background: "var(--cl-surface)",
                border: "none",
                borderTop: "1px solid var(--cl-border-subtle)",
                cursor: "pointer",
                padding: "8px 16px",
              }}
            >
              Show {hiddenCount} more
            </button>
          )}
        </div>
      )}
    </section>
  );
}
