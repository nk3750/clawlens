import { useState } from "react";
import { riskColorRaw } from "../../lib/utils";

const BASE = "/plugins/clawlens";

interface Props {
  toolCallId: string;
  /** True when the parent row has been acked — suppress clicks without hiding. */
  disabled?: boolean;
}

/**
 * Approve / Deny buttons for a T1 pending-approval hero.
 *
 * Race with Telegram and timer expiry is expected; the server responds 404
 * when `take()` returns undefined, which we surface as a muted "Already
 * resolved" label — the row will vanish on the next SSE refetch.
 *
 * Intentionally **no keyboard shortcuts** here. `a` / `d` are already bound
 * on T2 / T3 rows for ack / dismiss; reusing them on T1 would be ambiguous
 * when multiple rows are visible.
 */
export default function ResolveButtons({ toolCallId, disabled }: Props) {
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resolve = async (decision: "approve" | "deny") => {
    if (busy || disabled) return;
    setBusy(decision);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/attention/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolCallId, decision }),
      });
      if (res.status === 404) {
        setError("Already resolved");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Next SSE refetch removes the row — no manual refetch needed.
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  };

  const clickable = !busy && !disabled;
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          resolve("approve");
        }}
        disabled={!clickable}
        title="Approve this action"
        className="btn-press"
        style={{
          padding: "6px 12px",
          borderRadius: "var(--cl-radius-sm, 6px)",
          background: riskColorRaw("low"),
          color: "var(--cl-bg)",
          fontWeight: 600,
          fontSize: 12,
          border: "none",
          cursor: clickable ? "pointer" : "not-allowed",
          opacity: busy === "approve" ? 0.6 : disabled ? 0.5 : 1,
        }}
      >
        <span aria-hidden="true">✓</span> Approve
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          resolve("deny");
        }}
        disabled={!clickable}
        title="Deny this action"
        className="btn-press"
        style={{
          padding: "6px 12px",
          borderRadius: "var(--cl-radius-sm, 6px)",
          background: riskColorRaw("high"),
          color: "white",
          fontWeight: 600,
          fontSize: 12,
          border: "none",
          cursor: clickable ? "pointer" : "not-allowed",
          opacity: busy === "deny" ? 0.6 : disabled ? 0.5 : 1,
        }}
      >
        <span aria-hidden="true">✕</span> Deny
      </button>
      {error && (
        <span
          role="alert"
          className="font-sans text-[10px] ml-1"
          style={{ color: "var(--cl-text-muted)" }}
        >
          {error}
        </span>
      )}
    </div>
  );
}
