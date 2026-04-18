import { Link } from "react-router-dom";
import type { AttentionAgent } from "../../lib/types";
import { relTime, riskColorRaw } from "../../lib/utils";
import AckButtons from "./AckButtons";

interface Props {
  item: AttentionAgent;
  isLast: boolean;
  onOptimisticRemove: () => () => void;
  onPersisted: () => void;
  showShortcutHint?: boolean;
  isTopmost?: boolean;
}

/** T2b: an agent has crossed a clustering rule (block/hrisk/sustained). */
export default function AgentAttentionRow({
  item,
  isLast,
  onOptimisticRemove,
  onPersisted,
  showShortcutHint,
  isTopmost,
}: Props) {
  const borderColor = riskColorRaw(item.peakTier);

  return (
    <div
      className="flex items-center gap-3 px-4 py-3"
      data-cl-attention-row="agent"
      data-cl-attention-topmost={isTopmost ? "true" : undefined}
      style={{
        borderLeft: `3px solid ${borderColor}`,
        backgroundColor: "rgba(251, 191, 36, 0.05)",
        borderBottom: isLast ? undefined : "1px solid var(--cl-border-subtle)",
      }}
    >
      <span aria-hidden="true" className="text-sm shrink-0">
        ⚠
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className="font-sans text-sm font-semibold"
            style={{ color: "var(--cl-text-primary)" }}
          >
            {item.agentName}
          </span>
          <span
            className="font-mono text-[11px]"
            style={{ color: "var(--cl-text-secondary)" }}
            title={new Date(item.triggerAt).toLocaleString()}
          >
            · since {relTime(item.triggerAt)}
          </span>
          <span
            className="font-mono text-[10px] font-bold uppercase px-1.5 py-0.5 rounded"
            style={{
              color: borderColor,
              backgroundColor: `color-mix(in srgb, ${borderColor} 12%, transparent)`,
            }}
          >
            {item.peakTier}
          </span>
        </div>
        <p
          className="font-mono text-xs mt-0.5 truncate"
          style={{ color: "var(--cl-text-secondary)" }}
        >
          {item.description}
          {item.lastSessionKey && (
            <span
              className="font-mono text-[11px] ml-2"
              style={{ color: "var(--cl-text-muted)" }}
            >
              {truncateSessionKey(item.lastSessionKey)}
            </span>
          )}
        </p>
      </div>
      <Link
        to={`/agent/${encodeURIComponent(item.agentId)}`}
        data-cl-attention-view
        className="px-3 py-1 rounded-lg text-xs font-semibold shrink-0"
        style={{
          backgroundColor: "var(--cl-elevated)",
          color: "var(--cl-text-primary)",
          textDecoration: "none",
        }}
      >
        View agent
      </Link>
      <AckButtons
        scope={{ kind: "agent", agentId: item.agentId, upToIso: item.triggerAt }}
        onOptimisticRemove={onOptimisticRemove}
        onPersisted={onPersisted}
        showShortcutHint={showShortcutHint && isTopmost}
      />
    </div>
  );
}

function truncateSessionKey(key: string): string {
  if (key.length <= 30) return key;
  return `…${key.slice(-30)}`;
}
