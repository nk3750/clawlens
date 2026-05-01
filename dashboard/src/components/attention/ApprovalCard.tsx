import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { AttentionItem } from "../../lib/types";

interface Props {
  item: AttentionItem;
  /** When true, this card's left-border pulses (capped to one at a time). */
  pulsing: boolean;
}

const TIER_CLASS: Record<string, string> = {
  low: "cl-tier-low",
  medium: "cl-tier-med",
  high: "cl-tier-high",
  critical: "cl-tier-crit",
};

/**
 * T1 hero: pending approval. Resolution still happens via Telegram / webchat
 * until OpenClaw SDK exposes a plugin-side resolver (see openclaw#68626 /
 * clawLens#4).
 */
export default function ApprovalCard({ item, pulsing }: Props) {
  const tierClass = TIER_CLASS[item.riskTier] ?? "cl-tier-high";
  // T1 cards always carry the high-tier left border even when the individual
  // action registered low — the pending state itself is the severity signal.
  const stripeColor = "var(--cl-risk-high)";

  return (
    <div
      data-cl-attention-row="pending"
      data-cl-pulse={pulsing ? "true" : undefined}
      className={`cl-card${pulsing ? " attention-pulse" : ""}`}
      style={{
        position: "relative",
        padding: "14px 16px 14px 20px",
        overflow: "hidden",
        // Override the legacy attention-pulse box-shadow halo — the linear-
        // adjacent system pulses the left border only (via the stripe span
        // below). The class stays for tests + external consumers.
        boxShadow: "none",
        animation: "none",
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
          animation: pulsing ? "cl-pulse 1.8s ease-in-out infinite" : undefined,
        }}
      />
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 4,
              flexWrap: "wrap",
            }}
          >
            <span aria-hidden="true" style={{ fontSize: 15, lineHeight: 1 }}>
              ⏳
            </span>
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
              style={{
                fontFamily: "var(--cl-font-sans)",
                fontSize: 13,
                color: "var(--cl-text-muted)",
              }}
            >
              is waiting for approval
            </span>
            <span
              className={`cl-tier ${tierClass}`}
              style={{ marginLeft: "auto" }}
              title={`risk score ${item.riskScore}`}
            >
              {item.riskTier} {item.riskScore}
            </span>
          </div>
          <p
            className="code"
            style={{
              fontSize: 12,
              color: "var(--cl-text-secondary)",
              marginBottom: 4,
              wordBreak: "break-word",
            }}
          >
            {item.description}
          </p>
          {item.guardrailMatch && (
            <p style={{ marginBottom: 2 }}>
              <span
                className="cl-pill"
                title={`guardrail action: ${item.guardrailMatch.action}`}
              >
                matched guardrail · {item.guardrailMatch.action.replace(/_/g, " ")}
              </span>
              <span
                style={{
                  marginLeft: 8,
                  fontFamily: "var(--cl-font-mono)",
                  fontSize: 11,
                  color: "var(--cl-text-muted)",
                }}
              >
                {item.guardrailMatch.targetSummary}
              </span>
            </p>
          )}
          {item.kind === "pending" && (
            <p
              className="label-mono"
              style={{ color: "var(--cl-text-subdued)", textTransform: "none" }}
            >
              resolve via Telegram — dashboard resolution pending upstream SDK
            </p>
          )}
          {item.sessionKey && (
            <p
              style={{
                fontFamily: "var(--cl-font-mono)",
                fontSize: 11,
                color: "var(--cl-text-subdued)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {item.sessionKey}
            </p>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <ApprovalCountdown initialMs={item.timeoutMs ?? 0} />
          {item.sessionKey && (
            <Link
              to={`/session/${encodeURIComponent(item.sessionKey)}`}
              state={{ highlightToolCallId: item.toolCallId }}
              className="cl-btn cl-btn-primary"
              style={{ height: 28, padding: "0 12px", fontSize: 12 }}
            >
              Review
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function ApprovalCountdown({ initialMs }: { initialMs: number }) {
  const [remaining, setRemaining] = useState(initialMs);

  useEffect(() => {
    setRemaining(initialMs);
  }, [initialMs]);

  useEffect(() => {
    if (remaining <= 0) return;
    const timer = setInterval(() => {
      setRemaining((prev) => Math.max(0, prev - 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [remaining]);

  if (remaining <= 0) {
    return (
      <span
        style={{
          fontFamily: "var(--cl-font-mono)",
          fontFeatureSettings: "normal",
          fontSize: 12,
          color: "var(--cl-text-muted)",
        }}
      >
        Timed out
      </span>
    );
  }
  const totalSec = Math.ceil(remaining / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;

  return (
    <span
      style={{
        fontFamily: "var(--cl-font-mono)",
        fontFeatureSettings: "normal",
        fontSize: 14,
        fontWeight: 500,
        color: "var(--cl-text-primary)",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {min}:{sec.toString().padStart(2, "0")}
    </span>
  );
}
