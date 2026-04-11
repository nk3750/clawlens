import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import type { InterventionEntry, AgentInfo } from "../lib/types";
import { relTime, riskColorRaw } from "../lib/utils";

interface Props {
  interventions: InterventionEntry[];
  agents: AgentInfo[];
}

interface AttentionItem {
  key: string;
  type: "block" | "approval" | "agent";
  agentId: string;
  description: string;
  timestamp: string;
  sessionKey?: string;
  /** For approvals: seconds remaining until timeout */
  remainingMs?: number;
}

const APPROVAL_TIMEOUT_MS = 300_000; // 5 minutes

export default function NeedsAttention({ interventions, agents }: Props) {
  const items = buildItems(interventions, agents);

  if (items.length === 0) return null;

  return (
    <div className="mt-6">
      <div className="flex items-center gap-2 mb-3">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#fbbf24"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z M12 9v4 M12 17h.01" />
        </svg>
        <span
          className="text-xs font-medium tracking-wide uppercase"
          style={{ color: "#fbbf24" }}
        >
          {items.length} {items.length === 1 ? "item needs" : "items need"} attention
        </span>
      </div>

      <div
        className="rounded-xl border overflow-hidden"
        style={{
          backgroundColor: "var(--cl-surface)",
          borderColor: "var(--cl-border)",
        }}
      >
        {items.map((item, i) => (
          <AttentionRow
            key={item.key}
            item={item}
            isLast={i === items.length - 1}
          />
        ))}
      </div>
    </div>
  );
}

function AttentionRow({ item, isLast }: { item: AttentionItem; isLast: boolean }) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-3"
      style={{
        borderBottom: isLast ? undefined : "1px solid var(--cl-border-subtle)",
        backgroundColor:
          item.type === "block"
            ? "rgba(248, 113, 113, 0.03)"
            : item.type === "approval"
              ? "rgba(251, 191, 36, 0.03)"
              : undefined,
      }}
    >
      {/* Icon */}
      {item.type === "block" && (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke={riskColorRaw("high")}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0"
        >
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
      )}
      {item.type === "approval" && (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#fbbf24"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0"
        >
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
      )}
      {item.type === "agent" && (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#fbbf24"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z M12 9v4 M12 17h.01" />
        </svg>
      )}

      {/* Content */}
      <div className="min-w-0 flex-1">
        <p className="text-sm" style={{ color: "var(--cl-text-primary)" }}>
          <span className="font-semibold">{item.agentId}</span>
          <span style={{ color: "var(--cl-text-muted)" }}>
            {" \u00B7 "}
            {item.type === "block" ? "blocked" : item.type === "approval" ? "awaiting approval" : "needs attention"}
          </span>
        </p>
        <p className="text-xs mt-0.5 truncate" style={{ color: "var(--cl-text-secondary)" }}>
          {item.description}
          <span className="font-mono ml-1.5" style={{ color: "var(--cl-text-muted)" }}>
            {relTime(item.timestamp)}
          </span>
        </p>
      </div>

      {/* Approval countdown */}
      {item.type === "approval" && item.remainingMs != null && (
        <ApprovalCountdown initialMs={item.remainingMs} />
      )}

      {/* Action link */}
      {item.type === "agent" ? (
        <Link
          to={`/agent/${encodeURIComponent(item.agentId)}`}
          className="px-3 py-1 text-xs rounded-lg transition-colors shrink-0"
          style={{
            backgroundColor: "var(--cl-elevated)",
            color: "var(--cl-text-secondary)",
          }}
        >
          View
        </Link>
      ) : item.sessionKey ? (
        <Link
          to={`/session/${encodeURIComponent(item.sessionKey)}`}
          className="px-3 py-1 text-xs rounded-lg transition-colors shrink-0"
          style={{
            backgroundColor: "var(--cl-elevated)",
            color: "var(--cl-text-secondary)",
          }}
        >
          Review
        </Link>
      ) : null}
    </div>
  );
}

function ApprovalCountdown({ initialMs }: { initialMs: number }) {
  const [remaining, setRemaining] = useState(initialMs);

  useEffect(() => {
    if (remaining <= 0) return;
    const timer = setInterval(() => {
      setRemaining((prev) => Math.max(0, prev - 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [remaining]);

  if (remaining <= 0) {
    return (
      <span className="font-mono text-[10px] shrink-0" style={{ color: "var(--cl-text-muted)" }}>
        Timed out
      </span>
    );
  }

  const totalSec = Math.ceil(remaining / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;

  return (
    <span className="font-mono text-[10px] shrink-0" style={{ color: "#fbbf24" }}>
      &#9201; {min}:{sec.toString().padStart(2, "0")} remaining
    </span>
  );
}

function buildItems(interventions: InterventionEntry[], agents: AgentInfo[]): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const iv of interventions) {
    if (iv.effectiveDecision === "block") {
      items.push({
        key: `block-${iv.timestamp}`,
        type: "block",
        agentId: iv.agentId,
        description: iv.description,
        timestamp: iv.timestamp,
        sessionKey: iv.sessionKey,
      });
    } else if (iv.effectiveDecision === "pending") {
      const elapsed = Date.now() - new Date(iv.timestamp).getTime();
      items.push({
        key: `approval-${iv.timestamp}`,
        type: "approval",
        agentId: iv.agentId,
        description: iv.description,
        timestamp: iv.timestamp,
        sessionKey: iv.sessionKey,
        remainingMs: Math.max(0, APPROVAL_TIMEOUT_MS - elapsed),
      });
    }
  }

  for (const agent of agents) {
    if (agent.needsAttention) {
      items.push({
        key: `agent-${agent.id}`,
        type: "agent",
        agentId: agent.id,
        description: agent.attentionReason ?? "Multiple high-risk actions",
        timestamp: agent.lastActiveTimestamp ?? new Date().toISOString(),
      });
    }
  }

  return items;
}
