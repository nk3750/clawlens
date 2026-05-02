import { useState } from "react";
import { createPortal } from "react-dom";
import type { EntryResponse, GuardrailAction } from "../lib/types";
import { riskTierFromScore, riskColorRaw } from "../lib/utils";

interface Props {
  entry: EntryResponse;
  description: string;
  onClose: () => void;
  /**
   * Fired after a successful POST. `result.existing` is true when the
   * backend recognized an equivalent (selector, target) rule and returned
   * the original unchanged (idempotency). Callers that don't care about
   * the distinction can declare `() => void` — TS allows fewer-arg handlers.
   */
  onCreated: (result: { existing: boolean }) => void;
}

const BASE = "/plugins/clawlens";

export default function GuardrailModal({ entry, description, onClose, onCreated }: Props) {
  const [action, setAction] = useState<GuardrailAction>("block");
  const [scope, setScope] = useState<"agent" | "global">("agent");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tier = entry.riskScore != null ? riskTierFromScore(entry.riskScore) : null;
  const tierColor = tier ? riskColorRaw(tier) : null;

  const handleSubmit = async () => {
    setSaving(true);
    setError(null);

    // The legacy modal builds the most-conservative shape (per spec §16.4.1):
    // single tool, single agent (or null for global), identity-glob target
    // pre-filled with this call's identity key. Multi-tool / category /
    // path-glob / url-glob / command-glob rules are exposed via the API
    // until Phase 2's redesigned form lands.
    const pattern = entry.identityKey ?? "";

    try {
      const res = await fetch(`${BASE}/api/guardrails`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selector: {
            agent: scope === "global" ? null : (entry.agentId ?? null),
            tools: { mode: "names", values: [entry.toolName] },
          },
          target: {
            kind: "identity-glob",
            pattern,
          },
          action,
          source: {
            toolCallId: entry.toolCallId,
            sessionKey: entry.sessionKey ?? "",
            agentId: entry.agentId ?? "",
          },
          riskScore: entry.riskScore ?? 0,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as Record<string, string>).error || `HTTP ${res.status}`);
      }
      const body = (await res.json().catch(() => ({}))) as { existing?: boolean };
      onCreated({ existing: body.existing === true });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create guardrail");
    } finally {
      setSaving(false);
    }
  };

  // §13.1: portal to document.body so the modal escapes ancestor stacking
  // contexts (any transformed/will-change ancestor would otherwise re-anchor
  // `position: fixed`). Mirrors SwarmPopover.tsx:60 / DateChip.tsx:189.
  return createPortal(
    <div
      data-testid="guardrail-modal"
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{
        backgroundColor: "rgba(0,0,0,0.6)",
        animation: "var(--cl-spring-duration) var(--cl-spring) both cl-fade-in",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        data-testid="guardrail-modal-panel"
        className="rounded-xl p-6 w-full max-w-md"
        style={{
          backgroundColor: "var(--cl-surface)",
          border: "1px solid var(--cl-border)",
          animation: "var(--cl-spring-duration) var(--cl-spring) both cl-modal-in",
        }}
      >
        {/* Header */}
        <h2
          className="text-base font-semibold mb-4"
          style={{ color: "var(--cl-text-primary)", fontFamily: "'DM Sans', sans-serif" }}
        >
          ADD GUARDRAIL
        </h2>

        {/* Entry info */}
        <div
          className="rounded-lg p-3 mb-5"
          style={{ backgroundColor: "var(--cl-elevated)" }}
        >
          <p className="text-sm mb-1" style={{ color: "var(--cl-text-primary)" }}>
            {description}
          </p>
          <div className="flex items-center gap-3 mt-2">
            {entry.riskScore != null && tier && tierColor && (
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ backgroundColor: tierColor }}
                />
                <span className="font-mono text-xs" style={{ color: "var(--cl-text-secondary)" }}>
                  Risk: {entry.riskScore}
                </span>
                <span className="label-mono" style={{ color: tierColor }}>
                  {tier.toUpperCase()}
                </span>
              </span>
            )}
            {entry.agentId && (
              <span className="text-xs" style={{ color: "var(--cl-text-muted)" }}>
                Agent: {entry.agentId}
              </span>
            )}
          </div>
        </div>

        {/* Action selection */}
        <p className="text-xs font-medium mb-2" style={{ color: "var(--cl-text-muted)" }}>
          When this exact action happens again:
        </p>
        <div className="space-y-1.5 mb-5">
          {(
            [
              ["block", "Block"],
              ["require_approval", "Require Approval"],
              ["allow_notify", "Notify"],
            ] as const
          ).map(([value, label]) => (
            <label
              key={value}
              className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors"
              style={{
                backgroundColor: action === value ? "var(--cl-elevated)" : "transparent",
                color: "var(--cl-text-primary)",
              }}
            >
              <input
                type="radio"
                name="action"
                value={value}
                checked={action === value}
                onChange={() => setAction(value)}
                className="accent-current"
                style={{ accentColor: "var(--cl-accent)" }}
              />
              <span className="text-sm">{label}</span>
            </label>
          ))}
        </div>

        {/* Scope */}
        <p className="text-xs font-medium mb-2" style={{ color: "var(--cl-text-muted)" }}>
          Scope:
        </p>
        <div className="space-y-1.5 mb-5">
          <label
            className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer"
            style={{
              backgroundColor: scope === "agent" ? "var(--cl-elevated)" : "transparent",
              color: "var(--cl-text-primary)",
            }}
          >
            <input
              type="radio"
              name="scope"
              value="agent"
              checked={scope === "agent"}
              onChange={() => setScope("agent")}
              style={{ accentColor: "var(--cl-accent)" }}
            />
            <span className="text-sm">
              This agent only{entry.agentId ? ` (${entry.agentId})` : ""}
            </span>
          </label>
          <label
            className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer"
            style={{
              backgroundColor: scope === "global" ? "var(--cl-elevated)" : "transparent",
              color: "var(--cl-text-primary)",
            }}
          >
            <input
              type="radio"
              name="scope"
              value="global"
              checked={scope === "global"}
              onChange={() => setScope("global")}
              style={{ accentColor: "var(--cl-accent)" }}
            />
            <span className="text-sm">All agents</span>
          </label>
        </div>

        {/* Error */}
        {error && (
          <p className="text-xs mb-3" style={{ color: "var(--cl-risk-high)" }}>{error}</p>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg transition-colors"
            style={{
              color: "var(--cl-text-secondary)",
              backgroundColor: "var(--cl-elevated)",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="px-4 py-2 text-sm rounded-lg font-medium transition-colors"
            style={{
              backgroundColor: "var(--cl-accent)",
              color: "var(--cl-bg)",
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? "Adding..." : "Add Guardrail"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
