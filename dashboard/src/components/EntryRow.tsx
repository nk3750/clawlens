import { useState } from "react";
import { Link } from "react-router-dom";
import type { EntryResponse } from "../lib/types";
import {
  relTime,
  describeAction,
  decisionLabel,
  riskTierFromScore,
} from "../lib/utils";
import AgentAvatar from "./AgentAvatar";
import RiskBadge from "./RiskBadge";
import RiskTags from "./RiskTags";

const decisionColors: Record<string, string> = {
  allow: "text-status-active",
  block: "text-risk-high",
  approved: "text-risk-medium",
  denied: "text-risk-high",
  timeout: "text-muted",
  pending: "text-risk-medium",
  success: "text-status-active",
  failure: "text-risk-high",
};

/**
 * Action Item — a single agent action shown narratively.
 * "seo-bot searched for competitor keywords → allowed (risk 12)"
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
  const tier = entry.riskTier || (entry.riskScore != null ? riskTierFromScore(entry.riskScore) : undefined);
  const hasDetails = Object.keys(entry.params).length > 0 || entry.llmEvaluation || entry.policyRule;

  return (
    <div className={`group ${isNew ? "entry-flash" : ""}`}>
      <button
        onClick={() => hasDetails && setExpanded(!expanded)}
        className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-xl text-left transition-all duration-200 ${
          hasDetails ? "cursor-pointer hover:bg-surface/60" : "cursor-default"
        } ${expanded ? "bg-surface/40" : ""}`}
      >
        {/* Agent avatar */}
        {showAgent && entry.agentId && (
          <div className="pt-0.5">
            <AgentAvatar agentId={entry.agentId} size="sm" />
          </div>
        )}

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Main narrative line */}
          <div className="flex items-baseline gap-2 flex-wrap">
            {showAgent && entry.agentId && (
              <span className="font-display font-semibold text-primary text-[13px]">
                {entry.agentId}
              </span>
            )}
            <span className="text-secondary text-[13px]">
              {describeAction(entry)}
            </span>
            <span className="text-muted text-[11px]">{"\u2192"}</span>
            <span className={`text-[12px] font-medium ${decisionColors[entry.effectiveDecision] || "text-muted"}`}>
              {decisionLabel(entry.effectiveDecision)}
            </span>
          </div>

          {/* Risk tags inline */}
          {entry.riskTags && entry.riskTags.length > 0 && (
            <div className="mt-1">
              <RiskTags tags={entry.riskTags} />
            </div>
          )}
        </div>

        {/* Right side: risk + time */}
        <div className="flex items-center gap-2.5 shrink-0 pt-0.5">
          <RiskBadge score={entry.riskScore} tier={tier} />
          <span className="text-[11px] text-muted/60 font-mono w-14 text-right hidden sm:block">
            {relTime(entry.timestamp)}
          </span>
          {hasDetails && (
            <svg
              className={`w-3.5 h-3.5 text-muted/40 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          )}
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="ml-9 mr-3 mb-2 p-3 bg-surface/60 rounded-xl border border-border/30 space-y-3 animate-slide-in">
          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
            <span className="text-muted">Time</span>
            <span className="text-secondary font-mono text-[11px]">
              {new Date(entry.timestamp).toLocaleString()}
            </span>

            {entry.policyRule && (
              <>
                <span className="text-muted">Policy rule</span>
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
                <pre className="text-secondary/80 font-mono text-[11px] whitespace-pre-wrap break-all bg-deep/50 rounded-lg p-2 max-h-32 overflow-auto">
                  {JSON.stringify(entry.params, null, 2)}
                </pre>
              </>
            )}
          </div>

          {entry.llmEvaluation && (
            <div className="p-3 bg-deep/40 rounded-xl border border-border/20">
              <div className="text-[10px] font-display font-semibold text-muted uppercase tracking-wider mb-1.5">
                AI Risk Assessment
              </div>
              <blockquote className="text-xs text-secondary/90 italic border-l-2 border-accent/30 pl-3 leading-relaxed">
                {entry.llmEvaluation.reasoning}
              </blockquote>
              <div className="mt-2 flex items-center gap-3 text-[10px] text-muted">
                <span>
                  Adjusted score:{" "}
                  <span className="text-secondary font-mono">{entry.llmEvaluation.adjustedScore}</span>
                </span>
                <span>
                  Confidence: <span className="text-secondary">{entry.llmEvaluation.confidence}</span>
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
