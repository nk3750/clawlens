import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useKeyboardShortcut } from "../hooks/useKeyboardShortcut";
import type { AttentionAgent, AttentionItem, AttentionResponse } from "../lib/types";
import GuardrailModal from "./GuardrailModal";
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
  /** Keys animating out — still in DOM, but with `.cl-inbox-row-leave` applied. */
  const [leavingKeys, setLeavingKeys] = useState<Set<string>>(new Set());
  /** Pending Phase-2 timers, keyed by row key, so revert() can cancel them. */
  const leaveTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [guardrailDraft, setGuardrailDraft] = useState<AttentionItem | null>(null);
  const navigate = useNavigate();
  const containerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const timers = leaveTimersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

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
    // Phase 1: mark the row as leaving so the wrapper gets `.cl-inbox-row-leave`.
    setLeavingKeys((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    // Phase 2: after the animation, drop the row from render. A successful ack
    // refetch removes the item from the payload anyway; this covers the gap
    // between the POST resolving and the SSE-driven refetch landing.
    const timer = setTimeout(() => {
      setOptimisticRemoved((prev) => {
        if (prev.has(key)) return prev;
        const next = new Set(prev);
        next.add(key);
        return next;
      });
      setLeavingKeys((prev) => {
        if (!prev.has(key)) return prev;
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      leaveTimersRef.current.delete(key);
    }, 200);
    leaveTimersRef.current.set(key, timer);

    // Revert (fetch failure): cancel the pending timer and clear both sets so
    // the row snaps back into the enter state without lingering classes.
    return () => {
      const pending = leaveTimersRef.current.get(key);
      if (pending) {
        clearTimeout(pending);
        leaveTimersRef.current.delete(key);
      }
      setLeavingKeys((prev) => {
        if (!prev.has(key)) return prev;
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
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

  const hasPending = visiblePending.length > 0;

  return (
    <section
      ref={containerRef}
      data-attention-inbox
      data-cl-attention-anchor
      tabIndex={0}
      aria-label="Attention inbox"
      style={{ display: "flex", flexDirection: "column", gap: 10, outline: "none" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke={hasPending ? "var(--cl-risk-high)" : "var(--cl-risk-medium)"}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z M12 9v4 M12 17h.01" />
        </svg>
        <span className="label-mono" style={{ color: "var(--cl-text-secondary)" }}>
          {total} {total === 1 ? "item needs" : "items need"} attention
        </span>
      </div>

      {visiblePending.map((p, i) => (
        <ApprovalCard key={`t1-${p.toolCallId}`} item={p} pulsing={i === 0} />
      ))}

      {visibleList.length > 0 && (
        <div
          className="cl-card"
          style={{ overflow: "hidden" }}
        >
          {visibleList.map((v, i) => {
            const isLast = i === visibleList.length - 1 && hiddenCount === 0;
            const isTopmost = topmost && nonHeroKey(v) === nonHeroKey(topmost);
            const key = nonHeroKey(v);
            const removeFn = () => onOptimisticRemove(key);
            const wrapperClass = leavingKeys.has(key)
              ? "cl-inbox-row-leave"
              : "cl-inbox-row-enter";

            let row: ReactNode;
            if (v.kind === "agent") {
              row = (
                <AgentAttentionRow
                  item={v.item}
                  isLast={isLast}
                  onOptimisticRemove={removeFn}
                  onPersisted={onPersisted}
                  showShortcutHint
                  isTopmost={isTopmost}
                />
              );
            } else if (v.kind === "highrisk") {
              row = (
                <HighRiskRow
                  item={v.item}
                  isLast={isLast}
                  onOptimisticRemove={removeFn}
                  onPersisted={onPersisted}
                  onAddGuardrail={setGuardrailDraft}
                  showShortcutHint
                  isTopmost={isTopmost}
                />
              );
            } else {
              row = (
                <BlockedRow
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
              <div key={key} className={wrapperClass}>
                {row}
              </div>
            );
          })}
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="label-mono"
              style={{
                width: "100%",
                textAlign: "center",
                color: "var(--cl-text-muted)",
                background: "transparent",
                border: "none",
                borderTop: "1px solid var(--cl-border-subtle)",
                cursor: "pointer",
                padding: "8px 16px",
                textTransform: "none",
                letterSpacing: "0.04em",
              }}
            >
              show {hiddenCount} more
            </button>
          )}
        </div>
      )}

      {guardrailDraft && (
        <GuardrailModal
          entry={{
            timestamp: guardrailDraft.timestamp,
            toolName: guardrailDraft.toolName,
            toolCallId: guardrailDraft.toolCallId,
            agentId: guardrailDraft.agentId,
            riskScore: guardrailDraft.riskScore,
            params: {},
            effectiveDecision: "allow",
            category: "commands",
          }}
          description={guardrailDraft.description}
          onClose={() => setGuardrailDraft(null)}
          onCreated={() => {
            setGuardrailDraft(null);
            refetch();
          }}
        />
      )}
    </section>
  );
}
