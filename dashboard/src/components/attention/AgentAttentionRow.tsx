import { Link } from "react-router-dom";
import type { AttentionAgent } from "../../lib/types";
import { relTime } from "../../lib/utils";
import AckButtons from "./AckButtons";

interface Props {
  item: AttentionAgent;
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

const TIER_STRIPE: Record<string, string> = {
  low: "var(--cl-risk-low)",
  medium: "var(--cl-risk-medium)",
  high: "var(--cl-risk-high)",
  critical: "var(--cl-risk-critical)",
};

/** T2b: an agent has crossed a clustering rule (block/hrisk/sustained). */
export default function AgentAttentionRow({
  item,
  isLast,
  onOptimisticRemove,
  onPersisted,
  showShortcutHint,
  isTopmost,
}: Props) {
  const stripeColor = TIER_STRIPE[item.peakTier] ?? "var(--cl-risk-medium)";
  const tierClass = TIER_CLASS[item.peakTier] ?? "cl-tier-med";

  return (
    <div
      data-cl-attention-row="agent"
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
            title={new Date(item.triggerAt).toLocaleString()}
            style={{ textTransform: "none" }}
          >
            since {relTime(item.triggerAt)}
          </span>
          <span className={`cl-tier ${tierClass}`}>{item.peakTier}</span>
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
          {item.lastSessionKey && (
            <span style={{ marginLeft: 10, color: "var(--cl-text-subdued)" }}>
              {truncateSessionKey(item.lastSessionKey)}
            </span>
          )}
        </p>
      </div>
      <Link
        to={`/agent/${encodeURIComponent(item.agentId)}`}
        data-cl-attention-view
        className="cl-btn"
        style={{ height: 26, padding: "0 10px", fontSize: 12, flexShrink: 0 }}
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
