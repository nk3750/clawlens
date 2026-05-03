import { useCallback, useMemo } from "react";
import type { AttentionResponse } from "../../lib/types";

export const BULK_ACK_THRESHOLD = 2;

interface Props {
  data: AttentionResponse;
  optimisticRemoved: Set<string>;
  /** Same callback contract as AttentionInbox: returns a revert() to undo. */
  onOptimisticRemove: (key: string) => () => void;
  onPersisted: () => void;
}

interface VisibleItem {
  agentId: string;
  /** Matches AttentionInbox.nonHeroKey scheme; pending uses the "blocked:" prefix. */
  key: string;
}

function collectVisible(
  data: AttentionResponse,
  optimisticRemoved: Set<string>,
): VisibleItem[] {
  const items: VisibleItem[] = [];
  const push = (agentId: string, key: string) => {
    if (!optimisticRemoved.has(key)) items.push({ agentId, key });
  };
  for (const it of data.pending) push(it.agentId, `blocked:${it.toolCallId}`);
  for (const it of data.blocked) {
    const prefix = it.kind === "timeout" ? "timeout" : "blocked";
    push(it.agentId, `${prefix}:${it.toolCallId}`);
  }
  for (const it of data.highRisk) push(it.agentId, `highrisk:${it.toolCallId}`);
  for (const it of data.allowNotify ?? []) push(it.agentId, `allow_notify:${it.toolCallId}`);
  return items;
}

interface Chip {
  agentId: string;
  items: VisibleItem[];
}

export default function BulkAckChips({
  data,
  optimisticRemoved,
  onOptimisticRemove,
  onPersisted,
}: Props) {
  const chips = useMemo<Chip[]>(() => {
    const visible = collectVisible(data, optimisticRemoved);
    const byAgent = new Map<string, VisibleItem[]>();
    for (const item of visible) {
      const arr = byAgent.get(item.agentId);
      if (arr) arr.push(item);
      else byAgent.set(item.agentId, [item]);
    }
    const out: Chip[] = [];
    for (const [agentId, items] of byAgent) {
      if (items.length >= BULK_ACK_THRESHOLD) out.push({ agentId, items });
    }
    out.sort((a, b) => {
      if (b.items.length !== a.items.length) return b.items.length - a.items.length;
      return a.agentId < b.agentId ? -1 : a.agentId > b.agentId ? 1 : 0;
    });
    return out;
  }, [data, optimisticRemoved]);

  const handleClick = useCallback(
    (chip: Chip) => {
      const reverts = chip.items.map((it) => onOptimisticRemove(it.key));
      const upToIso = new Date().toISOString();
      fetch("/plugins/clawlens/api/attention/ack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: { kind: "agent", agentId: chip.agentId, upToIso },
        }),
      })
        .then((r) => {
          if (!r.ok) throw new Error("ack failed");
          onPersisted();
        })
        .catch(() => {
          for (const revert of reverts) revert();
        });
    },
    [onOptimisticRemove, onPersisted],
  );

  if (chips.length === 0) return null;

  return (
    <div
      role="group"
      aria-label="Bulk acknowledge"
      data-cl-bulk-ack-chips
      style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}
    >
      {chips.map((chip) => (
        <button
          key={chip.agentId}
          type="button"
          className="cl-bulk-ack-chip"
          aria-label={`Acknowledge all ${chip.items.length} attention items from ${chip.agentId}`}
          onClick={() => handleClick(chip)}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M20 6L9 17l-5-5" />
          </svg>
          Ack all from {chip.agentId} · {chip.items.length}
        </button>
      ))}
    </div>
  );
}
