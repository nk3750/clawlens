import { useState } from "react";
import type { AckScope } from "../../lib/types";

const BASE = "/plugins/clawlens";

interface Props {
  scope: AckScope;
  /**
   * Parent-driven optimistic removal: called before the fetch so the row can
   * fade out immediately. Returns a revert() function we invoke on failure.
   */
  onOptimisticRemove: () => () => void;
  /** Fired after a successful POST so the parent can refetch authoritatively. */
  onPersisted: () => void;
  showShortcutHint?: boolean;
}

export default function AckButtons({
  scope,
  onOptimisticRemove,
  onPersisted,
  showShortcutHint,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const revert = onOptimisticRemove();
    try {
      const res = await fetch(`${BASE}/api/attention/ack`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onPersisted();
    } catch (err) {
      revert();
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          send();
        }}
        disabled={busy}
        title="Ack (a)"
        className="px-2 py-1 rounded-md text-[11px] font-sans transition-colors"
        style={{
          backgroundColor: "transparent",
          color: "var(--cl-text-secondary)",
          border: "1px solid var(--cl-border-default)",
          cursor: busy ? "not-allowed" : "pointer",
          opacity: busy ? 0.5 : 1,
        }}
      >
        <span aria-hidden="true">✓</span> Ack
        {showShortcutHint && (
          <kbd
            className="ml-1 font-mono text-[9px] px-1 rounded"
            style={{
              color: "var(--cl-text-muted)",
              border: "1px solid var(--cl-border-subtle)",
            }}
          >
            a
          </kbd>
        )}
      </button>
      {error && (
        <span
          className="font-sans text-[10px]"
          style={{ color: "var(--cl-risk-high)" }}
          role="alert"
        >
          {error}
        </span>
      )}
    </div>
  );
}
