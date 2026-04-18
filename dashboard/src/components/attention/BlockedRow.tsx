import { Link } from "react-router-dom";
import type { AttentionItem } from "../../lib/types";
import { relTime, riskColorRaw } from "../../lib/utils";
import AckButtons from "./AckButtons";

interface Props {
  item: AttentionItem;
  isLast: boolean;
  onOptimisticRemove: () => () => void;
  onPersisted: () => void;
  showShortcutHint?: boolean;
  isTopmost?: boolean;
}

/** T2a: blocked or timed-out action. */
export default function BlockedRow({
  item,
  isLast,
  onOptimisticRemove,
  onPersisted,
  showShortcutHint,
  isTopmost,
}: Props) {
  const isBlock = item.kind === "blocked";
  const borderColor = isBlock ? riskColorRaw("high") : riskColorRaw("medium");
  const icon = isBlock ? "🚫" : "⏰";
  const bgColor = isBlock ? "rgba(248, 113, 113, 0.05)" : "rgba(251, 191, 36, 0.06)";

  return (
    <div
      className="flex items-center gap-3 px-4 py-3"
      data-cl-attention-row={isBlock ? "blocked" : "timeout"}
      data-cl-attention-topmost={isTopmost ? "true" : undefined}
      style={{
        borderLeft: `3px solid ${borderColor}`,
        backgroundColor: bgColor,
        borderBottom: isLast ? undefined : "1px solid var(--cl-border-subtle)",
      }}
    >
      <span aria-hidden="true" className="text-sm shrink-0">
        {icon}
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
            title={new Date(item.timestamp).toLocaleString()}
          >
            · {relTime(item.timestamp)}
          </span>
          <span
            className="font-mono text-[10px] font-bold uppercase px-1.5 py-0.5 rounded"
            style={{
              color: borderColor,
              backgroundColor: `color-mix(in srgb, ${borderColor} 12%, transparent)`,
            }}
          >
            {item.riskTier} ({item.riskScore})
          </span>
        </div>
        <p
          className="font-mono text-xs mt-0.5 truncate"
          style={{ color: "var(--cl-text-secondary)" }}
        >
          <span style={{ color: borderColor, fontWeight: 600 }}>
            {isBlock ? "Blocked " : "Timed out "}
          </span>
          {item.description}
          {item.sessionKey && (
            <span
              className="font-mono text-[11px] ml-2"
              style={{ color: "var(--cl-text-muted)" }}
            >
              {truncateSessionKey(item.sessionKey)}
            </span>
          )}
        </p>
      </div>
      {item.sessionKey && (
        <Link
          to={`/session/${encodeURIComponent(item.sessionKey)}`}
          state={{ highlightToolCallId: item.toolCallId }}
          data-cl-attention-view
          className="px-3 py-1 rounded-lg text-xs font-semibold shrink-0"
          style={{
            backgroundColor: "var(--cl-elevated)",
            color: "var(--cl-text-primary)",
            textDecoration: "none",
          }}
        >
          View session
        </Link>
      )}
      <AckButtons
        scope={{ kind: "entry", toolCallId: item.toolCallId }}
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
