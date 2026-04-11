import { useState, useCallback } from "react";
import { useApi } from "../hooks/useApi";
import type { Guardrail, GuardrailAction } from "../lib/types";
import { relTime, riskTierFromScore, riskColorRaw } from "../lib/utils";

const BASE = "/plugins/clawlens";

function actionLabel(action: GuardrailAction): string {
  switch (action.type) {
    case "block":
      return "BLOCK";
    case "require_approval":
      return "REQUIRE APPROVAL";
    case "allow_once":
      return "ALLOW ONCE";
    case "allow_hours":
      return `ALLOW FOR ${action.hours}H`;
  }
}

function actionColor(action: GuardrailAction): string {
  switch (action.type) {
    case "block":
      return "#ef4444";
    case "require_approval":
      return "#fbbf24";
    case "allow_once":
      return "#4ade80";
    case "allow_hours":
      return "#4ade80";
  }
}

function expiryText(g: Guardrail): string {
  if (!g.expiresAt) return "permanent";
  const remaining = new Date(g.expiresAt).getTime() - Date.now();
  if (remaining <= 0) return "expired";
  const hours = Math.ceil(remaining / 3_600_000);
  return hours > 24 ? `expires in ${Math.round(hours / 24)}d` : `expires in ${hours}h`;
}

export default function Guardrails() {
  const { data, loading, refetch } = useApi<{ guardrails: Guardrail[] }>("api/guardrails");
  const [filterAgent, setFilterAgent] = useState("");
  const [filterAction, setFilterAction] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);

  const handleDelete = useCallback(
    async (id: string) => {
      setDeleting(id);
      try {
        await fetch(`${BASE}/api/guardrails/${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
        refetch();
      } finally {
        setDeleting(null);
      }
    },
    [refetch],
  );

  const guardrails = data?.guardrails ?? [];
  const agents = [...new Set(guardrails.map((g) => g.agentId ?? "global"))].sort();

  let filtered = guardrails;
  if (filterAgent) {
    filtered = filtered.filter((g) =>
      filterAgent === "global" ? g.agentId === null : g.agentId === filterAgent,
    );
  }
  if (filterAction) {
    filtered = filtered.filter((g) => g.action.type === filterAction);
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1
            className="text-2xl font-bold tracking-tight"
            style={{
              fontFamily: "'Syne', sans-serif",
              color: "var(--cl-text-primary)",
            }}
          >
            GUARDRAILS
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--cl-text-muted)" }}>
            {guardrails.length} active
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6">
        <select
          value={filterAgent}
          onChange={(e) => setFilterAgent(e.target.value)}
          className="px-3 py-1.5 rounded-lg text-sm"
          style={{
            backgroundColor: "var(--cl-surface)",
            border: "1px solid var(--cl-border)",
            color: "var(--cl-text-primary)",
          }}
        >
          <option value="">All agents</option>
          {agents.map((a) => (
            <option key={a} value={a}>
              {a === "global" ? "Global" : a}
            </option>
          ))}
        </select>
        <select
          value={filterAction}
          onChange={(e) => setFilterAction(e.target.value)}
          className="px-3 py-1.5 rounded-lg text-sm"
          style={{
            backgroundColor: "var(--cl-surface)",
            border: "1px solid var(--cl-border)",
            color: "var(--cl-text-primary)",
          }}
        >
          <option value="">All actions</option>
          <option value="block">Block</option>
          <option value="require_approval">Require Approval</option>
          <option value="allow_once">Allow Once</option>
          <option value="allow_hours">Allow (timed)</option>
        </select>
      </div>

      {/* List */}
      {loading ? (
        <p className="text-sm py-8 text-center" style={{ color: "var(--cl-text-muted)" }}>
          Loading...
        </p>
      ) : filtered.length === 0 ? (
        <p className="text-sm py-8 text-center" style={{ color: "var(--cl-text-muted)" }}>
          {guardrails.length === 0
            ? "No guardrails yet. Add one from any entry in the Activity or Agent views."
            : "No guardrails match the current filters."}
        </p>
      ) : (
        <div className="space-y-2">
          {filtered.map((g) => (
            <GuardrailRow
              key={g.id}
              guardrail={g}
              deleting={deleting === g.id}
              onDelete={() => handleDelete(g.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function GuardrailRow({
  guardrail: g,
  deleting,
  onDelete,
}: {
  guardrail: Guardrail;
  deleting: boolean;
  onDelete: () => void;
}) {
  const tier = riskTierFromScore(g.riskScore);
  const tierColor = riskColorRaw(tier);
  const aColor = actionColor(g.action);

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 rounded-lg"
      style={{
        backgroundColor: "var(--cl-surface)",
        border: "1px solid var(--cl-border)",
      }}
    >
      {/* Shield icon */}
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke={aColor}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0"
      >
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>

      {/* Description */}
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate" style={{ color: "var(--cl-text-primary)" }}>
          {g.tool} — {g.identityKey}
        </p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className="label-mono" style={{ color: aColor }}>
            {actionLabel(g.action)}
          </span>
          <span className="text-xs" style={{ color: "var(--cl-text-muted)" }}>
            {g.agentId ?? "all agents"}
          </span>
          <span className="text-xs" style={{ color: "var(--cl-text-muted)" }}>
            {expiryText(g)}
          </span>
          <span className="text-xs" style={{ color: "var(--cl-text-muted)" }}>
            added {relTime(g.createdAt)}
          </span>
          {g.riskScore > 0 && (
            <span className="flex items-center gap-1">
              <span
                className="inline-block w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: tierColor }}
              />
              <span className="font-mono text-xs" style={{ color: "var(--cl-text-secondary)" }}>
                {g.riskScore}
              </span>
            </span>
          )}
        </div>
      </div>

      {/* Delete button */}
      <button
        onClick={onDelete}
        disabled={deleting}
        className="px-3 py-1.5 text-xs rounded-lg transition-colors"
        style={{
          backgroundColor: "var(--cl-elevated)",
          color: deleting ? "var(--cl-text-muted)" : "var(--cl-text-secondary)",
        }}
      >
        {deleting ? "..." : "Delete"}
      </button>
    </div>
  );
}
