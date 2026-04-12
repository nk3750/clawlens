import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import type { InterventionEntry, AgentInfo } from "../lib/types";
import { relTime, riskColorRaw } from "../lib/utils";

interface Props {
  interventions: InterventionEntry[];
  agents: AgentInfo[];
}

const APPROVAL_TIMEOUT_MS = 300_000; // 5 minutes

export default function NeedsAttention({ interventions, agents }: Props) {
  const [expanded, setExpanded] = useState(false);

  const tier1: InterventionEntry[] = [];
  const tier2: InterventionEntry[] = [];
  const tier3: InterventionEntry[] = [];

  for (const iv of interventions) {
    if (iv.effectiveDecision === "pending") {
      tier1.push(iv);
    } else if (iv.effectiveDecision === "block" || iv.effectiveDecision === "timeout") {
      tier2.push(iv);
    } else if (iv.effectiveDecision === "high_risk") {
      tier3.push(iv);
    }
  }

  const agentAttention = agents.filter((a) => a.needsAttention);

  type OtherItem =
    | { kind: "tier2"; entry: InterventionEntry }
    | { kind: "agent"; agent: AgentInfo }
    | { kind: "tier3"; entry: InterventionEntry };

  const otherItems: OtherItem[] = [
    ...tier2.map((e) => ({ kind: "tier2" as const, entry: e })),
    ...agentAttention.map((a) => ({ kind: "agent" as const, agent: a })),
    ...tier3.map((e) => ({ kind: "tier3" as const, entry: e })),
  ];

  const visibleOther = expanded ? otherItems : otherItems.slice(0, 3);
  const hiddenCount = otherItems.length - 3;

  const totalCount = tier1.length + otherItems.length;
  if (totalCount === 0) return null;

  const headerColor = tier1.length > 0
    ? riskColorRaw("high")
    : riskColorRaw("medium");

  return (
    <div className="flex flex-col" style={{ gap: 12 }}>
      {/* Section header */}
      <div className="flex items-center gap-2">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke={headerColor}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z M12 9v4 M12 17h.01" />
        </svg>
        <span
          className="font-sans text-xs font-medium tracking-wide uppercase"
          style={{ color: headerColor }}
        >
          {totalCount} {totalCount === 1 ? "item needs" : "items need"} attention
        </span>
      </div>

      {/* Tier 1: Pending approvals — always visible */}
      {tier1.map((iv) => (
        <Tier1Card key={`t1-${iv.timestamp}`} item={iv} />
      ))}

      {/* Other items: collapsible */}
      {visibleOther.length > 0 && (
        <div
          className="rounded-xl overflow-hidden"
          style={{
            border: "1px solid var(--cl-border-default)",
            borderRadius: 12,
          }}
        >
          {visibleOther.map((item, i) => {
            const isLast = i === visibleOther.length - 1 && (expanded || otherItems.length <= 3);
            if (item.kind === "tier2") {
              return <Tier2Row key={`t2-${item.entry.timestamp}`} item={item.entry} isLast={isLast} />;
            }
            if (item.kind === "agent") {
              return <Tier2AgentRow key={`t2a-${item.agent.id}`} agent={item.agent} isLast={isLast} />;
            }
            return <Tier3Row key={`t3-${item.entry.timestamp}`} item={item.entry} isLast={isLast} />;
          })}
          {!expanded && hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="w-full text-center font-sans text-xs transition-colors"
              style={{
                color: "var(--cl-text-muted)",
                background: "var(--cl-surface)",
                border: "none",
                borderTop: "1px solid var(--cl-border-subtle)",
                cursor: "pointer",
                padding: "8px 16px",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--cl-text-secondary)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--cl-text-muted)"; }}
            >
              Show {hiddenCount} more
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Tier 1: Pending Approval ──────────────────────────────

function Tier1Card({ item }: { item: InterventionEntry }) {
  const elapsed = Date.now() - new Date(item.timestamp).getTime();
  const remainingMs = Math.max(0, APPROVAL_TIMEOUT_MS - elapsed);

  return (
    <div
      className="rounded-xl attention-pulse"
      style={{
        background: "rgba(248, 113, 113, 0.08)",
        border: "1px solid rgba(248, 113, 113, 0.2)",
        borderRadius: 12,
        borderLeft: `4px solid ${riskColorRaw("high")}`,
        padding: "16px 20px",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-base">&#9203;</span>
            <span className="font-sans text-sm font-bold" style={{ color: "var(--cl-text-primary)" }}>
              {item.agentName}
            </span>
            <span className="font-sans text-sm" style={{ color: "var(--cl-text-secondary)" }}>
              is waiting for approval
            </span>
          </div>
          <p className="font-mono text-xs" style={{ color: "var(--cl-text-secondary)" }}>
            {item.description}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <ApprovalCountdown initialMs={remainingMs} />
          {item.sessionKey && (
            <Link
              to={`/session/${encodeURIComponent(item.sessionKey)}`}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-opacity"
              style={{
                backgroundColor: riskColorRaw("high"),
                color: "white",
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

// ── Tier 2: Blocked / Timed Out ───────────────────────────

function Tier2Row({ item, isLast }: { item: InterventionEntry; isLast: boolean }) {
  const isBlock = item.effectiveDecision === "block";
  const borderColor = isBlock ? riskColorRaw("high") : riskColorRaw("medium");
  const statusLabel = isBlock ? "blocked action" : "timed out";
  const icon = isBlock ? "\uD83D\uDEAB" : "\u23F0";
  const bgColor = isBlock ? "rgba(248, 113, 113, 0.05)" : "rgba(251, 191, 36, 0.06)";

  return (
    <div
      className="flex items-center gap-3 px-4 py-3"
      style={{
        borderLeft: `3px solid ${borderColor}`,
        backgroundColor: bgColor,
        borderBottom: isLast ? undefined : "1px solid var(--cl-border-subtle)",
      }}
    >
      <span className="text-sm shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="font-sans text-sm font-semibold" style={{ color: "var(--cl-text-primary)" }}>
            {item.agentName}
          </span>
          <span className="font-sans text-sm" style={{ color: borderColor }}>
            — {statusLabel}
          </span>
          <span className="font-mono text-[11px] ml-auto shrink-0" style={{ color: "var(--cl-text-secondary)" }}>
            {relTime(item.timestamp)}
          </span>
        </div>
        <p className="font-mono text-xs mt-0.5 truncate" style={{ color: "var(--cl-text-secondary)" }}>
          {item.description}
        </p>
      </div>
      {item.sessionKey && (
        <Link
          to={`/session/${encodeURIComponent(item.sessionKey)}`}
          className="px-3 py-1 rounded-lg text-xs transition-colors shrink-0"
          style={{
            backgroundColor: "var(--cl-elevated)",
            color: "var(--cl-text-secondary)",
          }}
        >
          Review
        </Link>
      )}
    </div>
  );
}

function Tier2AgentRow({ agent, isLast }: { agent: AgentInfo; isLast: boolean }) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-3"
      style={{
        borderLeft: `3px solid ${riskColorRaw("medium")}`,
        backgroundColor: "rgba(251, 191, 36, 0.05)",
        borderBottom: isLast ? undefined : "1px solid var(--cl-border-subtle)",
      }}
    >
      <span className="text-sm shrink-0">&#9888;</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="font-sans text-sm font-semibold" style={{ color: "var(--cl-text-primary)" }}>
            {agent.id}
          </span>
          <span className="font-sans text-sm" style={{ color: riskColorRaw("medium") }}>
            — needs attention
          </span>
        </div>
        <p className="font-mono text-xs mt-0.5 truncate" style={{ color: "var(--cl-text-secondary)" }}>
          {agent.attentionReason ?? "Multiple high-risk actions"}
        </p>
      </div>
      <Link
        to={`/agent/${encodeURIComponent(agent.id)}`}
        className="px-3 py-1 rounded-lg text-xs transition-colors shrink-0"
        style={{
          backgroundColor: "var(--cl-elevated)",
          color: "var(--cl-text-secondary)",
        }}
      >
        View
      </Link>
    </div>
  );
}

// ── Tier 3: High Risk Unguarded ───────────────────────────

function Tier3Row({ item, isLast }: { item: InterventionEntry; isLast: boolean }) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-2.5"
      style={{
        borderLeft: `2px solid ${riskColorRaw("medium")}`,
        backgroundColor: "rgba(251, 191, 36, 0.04)",
        borderBottom: isLast ? undefined : "1px solid var(--cl-border-subtle)",
      }}
    >
      <span className="text-sm shrink-0">&#9888;</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="font-sans text-sm font-semibold" style={{ color: "var(--cl-text-primary)" }}>
            {item.agentName}
          </span>
          <span className="font-sans text-sm" style={{ color: riskColorRaw("medium") }}>
            — high risk action
          </span>
          <span className="font-mono text-[11px] ml-auto shrink-0" style={{ color: "var(--cl-text-muted)" }}>
            {relTime(item.timestamp)}
          </span>
        </div>
        <p className="font-mono text-xs mt-0.5 truncate" style={{ color: "var(--cl-text-secondary)" }}>
          {item.description} <span style={{ color: "var(--cl-text-muted)" }}>(score {item.riskScore})</span>
        </p>
      </div>
      {item.sessionKey && (
        <Link
          to={`/session/${encodeURIComponent(item.sessionKey)}`}
          className="px-3 py-1 rounded-lg text-xs transition-colors shrink-0"
          style={{
            backgroundColor: "var(--cl-elevated)",
            color: "var(--cl-text-secondary)",
          }}
        >
          Review
        </Link>
      )}
    </div>
  );
}

// ── Shared: Approval Countdown ────────────────────────────

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
      <span className="font-mono text-[11px] shrink-0" style={{ color: "var(--cl-text-muted)" }}>
        Timed out
      </span>
    );
  }

  const totalSec = Math.ceil(remaining / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;

  return (
    <span
      className="font-mono text-lg font-bold attention-pulse"
      style={{ color: riskColorRaw("high") }}
    >
      {min}:{sec.toString().padStart(2, "0")}
    </span>
  );
}
