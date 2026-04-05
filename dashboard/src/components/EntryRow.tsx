import { useState } from "react";
import { Link } from "react-router-dom";
import type { EntryResponse } from "../lib/types";
import { relTime, describeAction, decisionLabel } from "../lib/utils";
import AgentAvatar from "./AgentAvatar";
import RiskBadge from "./RiskBadge";
import RiskTags from "./RiskTags";

/** Risk tier → dot color for the subtle indicator */
function riskDotColor(entry: EntryResponse): string {
  if (!entry.riskTier && entry.riskScore == null) return "#1e2130";
  const tier = entry.riskTier || (entry.riskScore! > 80 ? "critical" : entry.riskScore! > 60 ? "high" : entry.riskScore! > 30 ? "medium" : "low");
  return tier === "critical" ? "#ff4040" : tier === "high" ? "#f87171" : tier === "medium" ? "#fbbf24" : "#34d399";
}

const decisionColors: Record<string, string> = {
  allow: "text-muted",
  block: "text-risk-high",
  approved: "text-muted",
  denied: "text-risk-high",
  timeout: "text-muted",
  pending: "text-risk-medium",
  success: "text-muted",
  failure: "text-risk-high",
};

/**
 * Clean feed-style action item.
 * Surface: agent avatar + narrative + risk dot + time
 * Expand: full technical details (risk score, params, LLM eval, etc.)
 */
export default function EntryRow({
  entry,
  showAgent = true,
  isNew = false,
}: {
  entry: EntryResponse;
  index?: number;
  showAgent?: boolean;
  isNew?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = Object.keys(entry.params).length > 0 || entry.llmEvaluation || entry.policyRule || entry.riskScore != null;
  const dotColor = riskDotColor(entry);
  const isBlocked = entry.effectiveDecision === "block" || entry.effectiveDecision === "denied";
  const isPending = entry.effectiveDecision === "pending";

  return (
    <div className={isNew ? "entry-flash" : ""}>
      <button
        onClick={() => hasDetails && setExpanded(!expanded)}
        className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-all duration-200 ${
          hasDetails ? "cursor-pointer hover:bg-surface/40" : "cursor-default"
        } ${expanded ? "bg-surface/30" : ""}`}
      >
        {/* Risk dot */}
        <div
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ backgroundColor: dotColor }}
        />

        {/* Agent avatar */}
        {showAgent && entry.agentId && (
          <AgentAvatar agentId={entry.agentId} size="sm" />
        )}

        {/* Narrative */}
        <div className="flex-1 min-w-0 text-[13px]">
          {showAgent && entry.agentId && (
            <span className="font-display font-semibold text-primary mr-1.5">
              {entry.agentId}
            </span>
          )}
          <span className="text-secondary">{describeAction(entry)}</span>
          {(isBlocked || isPending) && (
            <span className={`ml-1.5 text-[11px] font-medium ${decisionColors[entry.effectiveDecision] || "text-muted"}`}>
              {"\u2014"} {decisionLabel(entry.effectiveDecision)}
            </span>
          )}
        </div>

        {/* Time */}
        <span className="text-[11px] text-muted/50 font-mono shrink-0 hidden sm:block">
          {relTime(entry.timestamp)}
        </span>

        {/* Expand chevron */}
        {hasDetails && (
          <svg
            className={`w-3 h-3 text-muted/30 transition-transform duration-200 shrink-0 ${expanded ? "rotate-180" : ""}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      {/* Expanded technical detail — progressive disclosure */}
      {expanded && (
        <div className="mx-3 mb-2 ml-8 p-3 bg-surface/50 rounded-xl border border-border/20 space-y-3 animate-slide-in">
          {/* Risk info */}
          {entry.riskScore != null && (
            <div className="flex items-center gap-4 text-xs">
              <RiskBadge score={entry.riskScore} tier={entry.riskTier} />
              <span className="text-muted">
                {entry.riskTier} risk {"\u00b7"} {decisionLabel(entry.effectiveDecision)}
              </span>
            </div>
          )}

          {entry.riskTags && entry.riskTags.length > 0 && (
            <RiskTags tags={entry.riskTags} />
          )}

          {/* Detail grid */}
          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
            <span className="text-muted">Time</span>
            <span className="text-secondary font-mono text-[11px]">
              {new Date(entry.timestamp).toLocaleString()}
            </span>
            {entry.policyRule && (
              <>
                <span className="text-muted">Policy</span>
                <span className="text-secondary font-mono text-[11px]">{entry.policyRule}</span>
              </>
            )}
            {entry.durationMs != null && (
              <>
                <span className="text-muted">Duration</span>
                <span className="text-secondary font-mono text-[11px]">{entry.durationMs}ms</span>
              </>
            )}
            {entry.sessionKey && (
              <>
                <span className="text-muted">Session</span>
                <Link
                  to={`/session/${encodeURIComponent(entry.sessionKey)}`}
                  className="text-accent hover:underline font-mono text-[11px] break-all"
                >
                  {entry.sessionKey}
                </Link>
              </>
            )}
            {Object.keys(entry.params).length > 0 && (
              <>
                <span className="text-muted">Params</span>
                <pre className="text-secondary/70 font-mono text-[10px] whitespace-pre-wrap break-all bg-deep/40 rounded-lg p-2 max-h-28 overflow-auto">
                  {JSON.stringify(entry.params, null, 2)}
                </pre>
              </>
            )}
          </div>

          {/* LLM evaluation */}
          {entry.llmEvaluation && (
            <div className="p-3 bg-deep/30 rounded-xl border border-border/15">
              <div className="text-[10px] font-display font-semibold text-muted uppercase tracking-wider mb-1.5">
                AI Assessment
              </div>
              <blockquote className="text-xs text-secondary/80 italic border-l-2 border-accent/20 pl-3 leading-relaxed">
                {entry.llmEvaluation.reasoning}
              </blockquote>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
