import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useKeyboardShortcut } from "../hooks/useKeyboardShortcut";
import type { AttentionItem, AttentionResponse } from "../lib/types";
import GuardrailModal from "./GuardrailModal";
import AllowNotifyRow from "./attention/AllowNotifyRow";
import ApprovalCard from "./attention/ApprovalCard";
import BlockedRow from "./attention/BlockedRow";
import BulkAckChips from "./attention/BulkAckChips";
import HighRiskRow from "./attention/HighRiskRow";

const INITIAL_VISIBLE_NON_HERO = 3;

type NonHeroKind = "blocked" | "timeout" | "highrisk" | "allow_notify";

interface NonHeroItem {
  kind: NonHeroKind;
  item: AttentionItem;
}

function nonHeroKey(v: NonHeroItem): string {
  return `${v.kind}:${v.item.toolCallId}`;
}

type SectionKind = "blocked" | "highrisk" | "allow_notify";

interface SectionDef {
  kind: SectionKind;
  label: string;
  matches: (v: NonHeroItem) => boolean;
}

// Severity-down. Collapse hides items from the bottom of this list, so BLOCKED
// rows are never the first to be hidden.
const NON_HERO_SECTIONS: readonly SectionDef[] = [
  { kind: "blocked", label: "BLOCKED", matches: (v) => v.kind === "blocked" || v.kind === "timeout" },
  { kind: "highrisk", label: "RISKY ACTIONS", matches: (v) => v.kind === "highrisk" },
  { kind: "allow_notify", label: "NOTIFY", matches: (v) => v.kind === "allow_notify" },
] as const;

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
      ...data.blocked.map<NonHeroItem>((item) => ({
        kind: item.kind === "timeout" ? "timeout" : "blocked",
        item,
      })),
      ...data.highRisk.map<NonHeroItem>((item) => ({ kind: "highrisk", item })),
      ...(data.allowNotify ?? []).map<NonHeroItem>((item) => ({
        kind: "allow_notify",
        item,
      })),
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
    },
    "[data-attention-inbox]",
    !!topmost,
  );

  useKeyboardShortcut(
    "v",
    () => {
      if (!topmost) return;
      if (topmost.item.sessionKey) {
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

  // Bucket counts come from visibleNonHero (post-optimistic-removal, pre-collapse).
  // Section item lists come from visibleList (post-collapse) so collapsed views
  // skip empty section headers entirely.
  const sections = NON_HERO_SECTIONS.map((s) => ({
    ...s,
    bucketCount: visibleNonHero.filter(s.matches).length,
    items: visibleList.filter(s.matches),
  }));
  const sectionsWithRows = sections.filter((s) => s.items.length > 0);
  const lastSectionWithRows = sectionsWithRows[sectionsWithRows.length - 1];

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
          stroke={visiblePending.length > 0 ? "var(--cl-risk-high)" : "var(--cl-risk-medium)"}
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

      <BulkAckChips
        data={data}
        optimisticRemoved={optimisticRemoved}
        onOptimisticRemove={onOptimisticRemove}
        onPersisted={onPersisted}
      />

      {visiblePending.length > 0 && (
        <span
          className="label-mono"
          data-cl-attention-section-header="pending"
          style={{ color: "var(--cl-text-muted)", marginTop: 6 }}
        >
          PENDING APPROVAL · {visiblePending.length}
        </span>
      )}

      {visiblePending.map((p, i) => (
        <ApprovalCard key={`t1-${p.toolCallId}`} item={p} pulsing={i === 0} />
      ))}

      {visibleList.length > 0 && (
        <div className="cl-card" style={{ overflow: "hidden" }}>
          {sections.map((section, sectionIdx) => {
            if (section.items.length === 0) return null;
            const isFirstSection =
              sections.findIndex((s) => s.items.length > 0) === sectionIdx;
            return (
              <Fragment key={section.kind}>
                <div
                  className="label-mono"
                  data-cl-attention-section-header={section.kind}
                  style={{
                    color: "var(--cl-text-muted)",
                    padding: "10px 14px 6px 18px",
                    borderTop: isFirstSection
                      ? undefined
                      : "1px solid var(--cl-border-subtle)",
                  }}
                >
                  {section.label} · {section.bucketCount}
                </div>
                {section.items.map((v, i) => {
                  const isLastInSection = i === section.items.length - 1;
                  const isLast =
                    section === lastSectionWithRows && isLastInSection && hiddenCount === 0;
                  const isTopmost = topmost && nonHeroKey(v) === nonHeroKey(topmost);
                  const key = nonHeroKey(v);
                  const removeFn = () => onOptimisticRemove(key);
                  const wrapperClass = leavingKeys.has(key)
                    ? "cl-inbox-row-leave"
                    : "cl-inbox-row-enter";

                  let row: ReactNode;
                  if (v.kind === "highrisk") {
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
                  } else if (v.kind === "allow_notify") {
                    row = (
                      <AllowNotifyRow
                        item={v.item}
                        isLast={isLast}
                        onOptimisticRemove={removeFn}
                        onPersisted={onPersisted}
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
              </Fragment>
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
            category: "scripts",
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
