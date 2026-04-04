import { useState } from "react";
import { Link } from "react-router-dom";
import type { EntryResponse } from "../lib/types";
import { relTime } from "../lib/utils";
import RiskBadge from "./RiskBadge";
import RiskTags from "./RiskTags";

const decisionStyles: Record<string, string> = {
  allow: "bg-emerald-500/10 text-emerald-400",
  block: "bg-red-500/10 text-red-400",
  approved: "bg-amber-500/10 text-amber-400",
  denied: "bg-zinc-500/10 text-zinc-400",
  timeout: "bg-zinc-500/10 text-zinc-400",
  pending: "bg-amber-500/10 text-amber-400",
  success: "bg-emerald-500/10 text-emerald-400",
  failure: "bg-red-500/10 text-red-400",
};

const riskBorderColors: Record<string, string> = {
  low: "border-l-risk-low/30",
  medium: "border-l-risk-medium/40",
  high: "border-l-risk-high/50",
  critical: "border-l-risk-critical/70",
};

export default function EntryRow({
  entry,
  index,
}: {
  entry: EntryResponse;
  index: number;
}) {
  const [expanded, setExpanded] = useState(false);

  const borderColor = entry.riskTier
    ? riskBorderColors[entry.riskTier] || "border-l-border"
    : "border-l-border";

  const hasParams = Object.keys(entry.params).length > 0;

  return (
    <div
      className={`bg-card border border-border rounded-lg overflow-hidden transition-all duration-200 animate-fade-in border-l-2 ${borderColor} ${
        expanded ? "border-border-hover" : "hover:border-border-hover/60"
      }`}
      style={{ animationDelay: `${Math.min(index, 20) * 30}ms` }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full grid grid-cols-[1fr_auto_auto] md:grid-cols-[90px_1fr_auto_auto_auto] items-center gap-2 md:gap-3 px-3 py-2.5 text-left cursor-pointer"
      >
        <span className="hidden md:block text-xs text-muted font-mono whitespace-nowrap">
          {relTime(entry.timestamp)}
        </span>
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-sm text-primary truncate">
            {entry.toolName}
          </span>
          {entry.agentId && (
            <span className="hidden lg:inline text-[10px] px-1.5 py-0.5 rounded bg-surface text-muted font-mono shrink-0">
              {entry.agentId}
            </span>
          )}
          <span className="md:hidden text-[10px] text-muted font-mono shrink-0">
            {relTime(entry.timestamp)}
          </span>
        </div>
        <RiskBadge score={entry.riskScore} tier={entry.riskTier} />
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap ${
            decisionStyles[entry.effectiveDecision] ||
            "bg-zinc-500/10 text-zinc-400"
          }`}
        >
          {entry.effectiveDecision}
        </span>
        <svg
          className={`hidden md:block w-4 h-4 text-muted transition-transform shrink-0 ${expanded ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-2 border-t border-border space-y-3 animate-slide-in">
          {entry.riskTags && entry.riskTags.length > 0 && (
            <RiskTags tags={entry.riskTags} />
          )}

          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
            <span className="text-muted">Time</span>
            <span className="text-secondary font-mono">
              {new Date(entry.timestamp).toLocaleString()}
            </span>

            {entry.policyRule && (
              <>
                <span className="text-muted">Rule</span>
                <span className="text-secondary font-mono">
                  {entry.policyRule}
                </span>
              </>
            )}
            {entry.executionResult && (
              <>
                <span className="text-muted">Result</span>
                <span className="text-secondary">
                  {entry.executionResult}
                </span>
              </>
            )}
            {entry.durationMs != null && (
              <>
                <span className="text-muted">Duration</span>
                <span className="text-secondary font-mono">
                  {entry.durationMs}ms
                </span>
              </>
            )}
            {entry.toolCallId && (
              <>
                <span className="text-muted">Call ID</span>
                <span className="text-secondary font-mono text-[11px] break-all">
                  {entry.toolCallId}
                </span>
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
            {hasParams && (
              <>
                <span className="text-muted">Params</span>
                <pre className="text-secondary font-mono text-[11px] whitespace-pre-wrap break-all bg-surface rounded p-2 max-h-40 overflow-auto">
                  {JSON.stringify(entry.params, null, 2)}
                </pre>
              </>
            )}
          </div>

          {entry.llmEvaluation && (
            <div className="p-3 bg-surface rounded-lg border border-border/50">
              <div className="text-[11px] font-semibold text-muted uppercase tracking-wider mb-1.5">
                LLM Evaluation
              </div>
              <blockquote className="text-xs text-secondary italic border-l-2 border-accent/30 pl-2">
                {entry.llmEvaluation.reasoning}
              </blockquote>
              <div className="mt-2 flex items-center gap-3 text-[10px] text-muted">
                <span>
                  Score:{" "}
                  <span className="text-secondary font-mono">
                    {entry.llmEvaluation.adjustedScore}
                  </span>
                </span>
                <span>
                  Confidence:{" "}
                  <span className="text-secondary">
                    {entry.llmEvaluation.confidence}
                  </span>
                </span>
              </div>
              {entry.llmEvaluation.patterns.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {entry.llmEvaluation.patterns.map((p) => (
                    <span
                      key={p}
                      className="px-1.5 py-0.5 rounded text-[10px] bg-elevated text-muted"
                    >
                      {p}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
