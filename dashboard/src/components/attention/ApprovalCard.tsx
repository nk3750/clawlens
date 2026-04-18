import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { AttentionItem } from "../../lib/types";
import { riskColorRaw } from "../../lib/utils";
import ResolveButtons from "./ResolveButtons";

interface Props {
  item: AttentionItem;
  /** When true, this card shows the pulse animation (capped to one at a time). */
  pulsing: boolean;
}

/**
 * T1 hero: pending approval. Countdown + in-place Approve/Deny + Review link.
 * Approve/Deny race cleanly with Telegram and the OpenClaw timer — whichever
 * fires first wins via the PendingApprovalStore's single-winner take().
 */
export default function ApprovalCard({ item, pulsing }: Props) {
  const riskColor = riskColorRaw(item.riskTier);
  return (
    <div
      className={pulsing ? "attention-pulse" : undefined}
      data-cl-attention-row="pending"
      style={{
        background: "rgba(248, 113, 113, 0.08)",
        border: "1px solid rgba(248, 113, 113, 0.2)",
        borderRadius: 12,
        borderLeft: `4px solid ${riskColorRaw("high")}`,
        padding: "16px 20px",
        opacity: item.ackedAt ? 0.6 : 1,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span aria-hidden="true" className="text-base">
              ⏳
            </span>
            <span
              className="font-sans text-sm font-bold"
              style={{ color: "var(--cl-text-primary)" }}
            >
              {item.agentName}
            </span>
            <span className="font-sans text-sm" style={{ color: "var(--cl-text-secondary)" }}>
              is waiting for approval
            </span>
            <span
              className="font-mono text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ml-auto"
              style={{
                color: riskColor,
                backgroundColor: `color-mix(in srgb, ${riskColor} 12%, transparent)`,
              }}
            >
              {item.riskTier} ({item.riskScore})
            </span>
          </div>
          <p
            className="font-mono text-xs mb-1"
            style={{ color: "var(--cl-text-secondary)" }}
          >
            {item.description}
          </p>
          {item.sessionKey && (
            <p
              className="font-mono text-[11px] truncate"
              style={{ color: "var(--cl-text-muted)" }}
            >
              {item.sessionKey}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <ApprovalCountdown initialMs={item.timeoutMs ?? 0} />
          <ResolveButtons toolCallId={item.toolCallId} disabled={!!item.ackedAt} />
          {item.sessionKey && (
            <Link
              to={`/session/${encodeURIComponent(item.sessionKey)}`}
              state={{ highlightToolCallId: item.toolCallId }}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold"
              style={{
                backgroundColor: riskColorRaw("high"),
                color: "white",
                textDecoration: "none",
              }}
            >
              Review →
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
        className="font-mono text-[11px] shrink-0"
        style={{ color: "var(--cl-text-muted)" }}
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
      className="font-mono text-lg font-bold"
      style={{ color: riskColorRaw("high") }}
    >
      {min}:{sec.toString().padStart(2, "0")}
    </span>
  );
}
