import { Link } from "react-router-dom";
import type { AttentionItem } from "../../lib/types";
import { relTime, riskColorRaw } from "../../lib/utils";
import AckButtons from "./AckButtons";

interface Props {
  item: AttentionItem;
  isLast: boolean;
  onOptimisticRemove: () => () => void;
  onPersisted: () => void;
  /** Optional: when provided, renders a 🛡 button that hands the item to the parent's guardrail modal. */
  onAddGuardrail?: (item: AttentionItem) => void;
  showShortcutHint?: boolean;
  isTopmost?: boolean;
}

/** T3: single unguarded high-risk allow. Thinner row, yellow tint. */
export default function HighRiskRow({
  item,
  isLast,
  onOptimisticRemove,
  onPersisted,
  onAddGuardrail,
  showShortcutHint,
  isTopmost,
}: Props) {
  const borderColor = riskColorRaw(item.riskTier);

  return (
    <div
      className="flex items-center gap-3 px-4 py-2.5"
      data-cl-attention-row="highrisk"
      data-cl-attention-topmost={isTopmost ? "true" : undefined}
      style={{
        borderLeft: `2px solid ${borderColor}`,
        backgroundColor: "rgba(251, 191, 36, 0.04)",
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
            style={{ color: "var(--cl-text-muted)" }}
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
          {item.guardrailHint && (
            <span style={{ color: "var(--cl-text-muted)" }}>Unguarded: </span>
          )}
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
          View
        </Link>
      )}
      {onAddGuardrail && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onAddGuardrail(item);
          }}
          className="px-3 py-1 rounded-lg text-xs font-semibold shrink-0"
          style={{
            backgroundColor: "var(--cl-elevated)",
            border: "1px solid var(--cl-border-default)",
            color: "var(--cl-text-primary)",
            cursor: "pointer",
          }}
          title="Add a guardrail to govern this tool + identity key"
        >
          🛡 Add guardrail
        </button>
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
