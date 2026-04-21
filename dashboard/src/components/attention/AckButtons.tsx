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
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
      <button
        type="button"
        className="cl-btn"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          send();
        }}
        disabled={busy}
        title="Ack (a)"
        style={{
          height: 26,
          padding: "0 10px",
          fontSize: 12,
        }}
      >
        <span aria-hidden="true">✓</span>
        <span>Ack</span>
        {showShortcutHint && (
          <kbd
            className="cl-pill"
            style={{
              marginLeft: 4,
              padding: "2px 5px",
              fontSize: 9,
            }}
          >
            a
          </kbd>
        )}
      </button>
      {error && (
        <span
          role="alert"
          className="label-mono"
          style={{ color: "var(--cl-risk-high)", fontSize: 10 }}
        >
          {error}
        </span>
      )}
    </div>
  );
}
