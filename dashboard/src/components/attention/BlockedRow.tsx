import { Link } from "react-router-dom";
import type { AttentionItem } from "../../lib/types";
import { relTime } from "../../lib/utils";
import AckButtons from "./AckButtons";

interface Props {
  item: AttentionItem;
  isLast: boolean;
  onOptimisticRemove: () => () => void;
  onPersisted: () => void;
  showShortcutHint?: boolean;
  isTopmost?: boolean;
}

const TIER_CLASS: Record<string, string> = {
  low: "cl-tier-low",
  medium: "cl-tier-med",
  high: "cl-tier-high",
  critical: "cl-tier-crit",
};

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
  const stripeColor = isBlock ? "var(--cl-risk-high)" : "var(--cl-risk-medium)";
  const tierClass = TIER_CLASS[item.riskTier] ?? "cl-tier-med";

  return (
    <div
      data-cl-attention-row={isBlock ? "blocked" : "timeout"}
      data-cl-attention-topmost={isTopmost ? "true" : undefined}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px 10px 18px",
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
          width: 3,
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
          <span style={{ color: stripeColor, fontWeight: 500 }}>
            {isBlock ? "Blocked " : "Timed out "}
          </span>
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
