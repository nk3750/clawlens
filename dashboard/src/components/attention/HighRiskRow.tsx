import { Link } from "react-router-dom";
import type { AttentionItem } from "../../lib/types";
import { relTime } from "../../lib/utils";
import AckButtons from "./AckButtons";

interface Props {
  item: AttentionItem;
  isLast: boolean;
  onOptimisticRemove: () => () => void;
  onPersisted: () => void;
  /** Optional: when provided, renders an Add-guardrail button that hands the item to the parent modal. */
  onAddGuardrail?: (item: AttentionItem) => void;
  showShortcutHint?: boolean;
  isTopmost?: boolean;
}

const TIER_CLASS: Record<string, string> = {
  low: "cl-tier-low",
  medium: "cl-tier-med",
  high: "cl-tier-high",
  critical: "cl-tier-crit",
};

const TIER_STRIPE: Record<string, string> = {
  low: "var(--cl-risk-low)",
  medium: "var(--cl-risk-medium)",
  high: "var(--cl-risk-high)",
  critical: "var(--cl-risk-critical)",
};

/** T3: single unguarded high-risk allow. Thinner row. */
export default function HighRiskRow({
  item,
  isLast,
  onOptimisticRemove,
  onPersisted,
  onAddGuardrail,
  showShortcutHint,
  isTopmost,
}: Props) {
  const stripeColor = TIER_STRIPE[item.riskTier] ?? "var(--cl-risk-medium)";
  const tierClass = TIER_CLASS[item.riskTier] ?? "cl-tier-med";

  return (
    <div
      data-cl-attention-row="highrisk"
      data-cl-attention-topmost={isTopmost ? "true" : undefined}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 14px 8px 18px",
        borderBottom: isLast ? undefined : "1px solid var(--cl-border-subtle)",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 2,
          background: stripeColor,
        }}
      />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span
            style={{
              fontFamily: "var(--cl-font-sans)",
              fontSize: 14,
              fontWeight: 510,
              color: "var(--cl-text-primary)",
            }}
          >
            {item.agentName}
          </span>
          <span
            className="label-mono"
            title={new Date(item.timestamp).toLocaleString()}
            style={{ textTransform: "none" }}
          >
            {relTime(item.timestamp)}
          </span>
          <span className={`cl-tier ${tierClass}`} title={`risk ${item.riskScore}`}>
            {item.riskTier} {item.riskScore}
          </span>
          {item.guardrailHint && (
            <span className="cl-pill" title={item.guardrailHint}>
              Unguarded
            </span>
          )}
        </div>
        <p
          style={{
            fontFamily: "var(--cl-font-mono)",
            fontFeatureSettings: "normal",
            fontSize: 12,
            color: "var(--cl-text-secondary)",
            marginTop: 3,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {item.description}
          {item.sessionKey && (
            <span style={{ marginLeft: 10, color: "var(--cl-text-subdued)" }}>
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
          className="cl-btn"
          style={{ height: 26, padding: "0 10px", fontSize: 12, flexShrink: 0 }}
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
          className="cl-btn"
          title="Add a guardrail to govern this tool + identity key"
          style={{ height: 26, padding: "0 10px", fontSize: 12, flexShrink: 0 }}
        >
          Add guardrail
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
