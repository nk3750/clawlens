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

/**
 * #51 — guardrail rule with action: "allow_notify" fired. Informational
 * row, dismissible. Click → /guardrails?selected=<rule id> to inspect or
 * tighten the rule. The visual key is `--cl-info` (low-attention blue);
 * tier color is intentionally not used because the operator chose to
 * allow this class of call.
 */
export default function AllowNotifyRow({
  item,
  isLast,
  onOptimisticRemove,
  onPersisted,
  showShortcutHint,
  isTopmost,
}: Props) {
  const ruleId = item.guardrailMatch?.id;

  return (
    <div
      data-cl-attention-row="allow_notify"
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
          background: "var(--cl-info, #60a5fa)",
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
          <span className="cl-pill" title="allow + notify guardrail fired">
            allow + notify
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
          {item.description}
          {item.guardrailMatch?.targetSummary && (
            <span style={{ marginLeft: 10, color: "var(--cl-text-subdued)" }}>
              {item.guardrailMatch.targetSummary}
            </span>
          )}
        </p>
      </div>
      {ruleId && (
        <Link
          to={`/guardrails?selected=${encodeURIComponent(ruleId)}`}
          data-cl-attention-view
          data-testid={`allow-notify-rule-link-${ruleId}`}
          className="cl-btn"
          style={{ height: 26, padding: "0 10px", fontSize: 12, flexShrink: 0 }}
        >
          See guardrail
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
