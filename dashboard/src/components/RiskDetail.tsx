import { useState } from "react";
import type { EntryResponse } from "../lib/types";
import { riskTierFromScore, riskColor, riskColorRaw, formatDuration } from "../lib/utils";

interface Props {
  entry: EntryResponse;
}

function paramSummary(entry: EntryResponse): string {
  const p = entry.params;
  if (entry.toolName === "exec" || entry.toolName === "process") {
    const cmd = typeof p.command === "string" ? p.command : "";
    return cmd.length > 80 ? `${cmd.slice(0, 77)}...` : cmd;
  }
  if (entry.toolName === "read" || entry.toolName === "write" || entry.toolName === "edit") {
    return String(p.file_path ?? p.path ?? "");
  }
  if (entry.toolName === "web_fetch" || entry.toolName === "fetch_url") {
    return String(p.url ?? "");
  }
  if (entry.toolName === "web_search" || entry.toolName === "search") {
    return String(p.query ?? "");
  }
  const keys = Object.keys(p);
  if (keys.length === 0) return "{}";
  const val = typeof p[keys[0]] === "string" ? p[keys[0]] : JSON.stringify(p[keys[0]]);
  const str = `${keys[0]}: ${val}`;
  return str.length > 80 ? `${str.slice(0, 77)}...` : str;
}

export default function RiskDetail({ entry }: Props) {
  const tier = entry.riskTier ?? (entry.riskScore != null ? riskTierFromScore(entry.riskScore) : "low");
  const color = riskColor(tier);
  const rawColor = riskColorRaw(tier);
  const llm = entry.llmEvaluation;

  return (
    <div className="space-y-4 pt-3 pb-1">
      {/* Risk score + tier */}
      {entry.riskScore != null && (
        <div className="flex items-center gap-3">
          <span
            className="font-mono text-lg font-bold"
            style={{ color, textShadow: `0 0 12px ${rawColor}40` }}
          >
            {entry.riskScore}
          </span>
          <span className="label-mono" style={{ color }}>
            {tier === "low" ? "Low risk" : tier === "medium" ? "Medium" : tier === "high" ? "High" : "Critical"}
          </span>
        </div>
      )}

      {/* Risk tags */}
      {entry.riskTags && entry.riskTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {entry.riskTags.map((tag) => (
            <span
              key={tag}
              className="label-mono px-2 py-0.5 rounded"
              style={{
                backgroundColor: "var(--cl-accent-7)",
                color: "var(--cl-text-secondary)",
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* LLM AI Assessment */}
      {llm && (
        <div>
          <h4
            className="font-display font-semibold mb-2"
            style={{ fontSize: "var(--text-subhead)", color: "var(--cl-text-primary)" }}
          >
            AI Assessment
          </h4>

          {/* Score adjustment */}
          <div className="flex items-center gap-2 mb-2">
            <span className="label-mono" style={{ color: "var(--cl-text-secondary)" }}>
              tier 1: {entry.originalRiskScore ?? entry.riskScore}
            </span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--cl-text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
            <span className="label-mono" style={{ color }}>
              llm: {llm.adjustedScore}
            </span>
          </div>

          {/* Reasoning */}
          <div
            className="text-sm pl-3 mb-3"
            style={{
              borderLeft: `2px solid ${rawColor}40`,
              color: "var(--cl-text-secondary)",
              lineHeight: 1.6,
            }}
          >
            {llm.reasoning}
          </div>

          {/* Confidence + Patterns */}
          <div className="flex flex-wrap gap-4">
            <span className="label-mono" style={{ color: "var(--cl-text-secondary)" }}>
              confidence: {llm.confidence}
            </span>
            {llm.patterns.length > 0 && (
              <span className="label-mono" style={{ color: "var(--cl-text-secondary)" }}>
                patterns: {llm.patterns.join(", ")}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Collapsible params */}
      <ParamsSection entry={entry} />

      {/* Metadata row */}
      <div className="flex flex-wrap gap-x-5 gap-y-1.5">
        {entry.policyRule && (
          <span className="label-mono" style={{ color: "var(--cl-text-secondary)" }}>
            rule: {entry.policyRule}
          </span>
        )}
        {entry.durationMs != null && (
          <span className="label-mono" style={{ color: "var(--cl-text-secondary)" }}>
            duration: {formatDuration(entry.durationMs)}
          </span>
        )}
        {entry.toolCallId && (
          <span className="label-mono" style={{ color: "var(--cl-text-muted)" }}>
            {entry.toolCallId}
          </span>
        )}
      </div>
    </div>
  );
}

function ParamsSection({ entry }: { entry: EntryResponse }) {
  const [expanded, setExpanded] = useState(false);
  const summary = paramSummary(entry);

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full text-left"
      >
        <h4 className="label-mono" style={{ color: "var(--cl-text-secondary)" }}>
          PARAMETERS
        </h4>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--cl-text-muted)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0 transition-transform"
          style={{
            transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
            transitionDuration: "var(--cl-spring-duration)",
            transitionTimingFunction: "var(--cl-spring)",
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* One-liner summary (always visible) */}
      {!expanded && summary && (
        <div
          className="text-xs font-mono mt-1.5 truncate"
          style={{ color: "var(--cl-text-secondary)" }}
        >
          {summary}
        </div>
      )}

      {/* Full JSON (toggle) */}
      <div
        className="grid transition-all"
        style={{
          gridTemplateRows: expanded ? "1fr" : "0fr",
          transitionDuration: "var(--cl-spring-duration)",
          transitionTimingFunction: "var(--cl-spring)",
        }}
      >
        <div className="overflow-hidden">
          <pre
            className="text-xs font-mono p-3 rounded-lg overflow-x-auto mt-1.5"
            style={{
              backgroundColor: "var(--cl-elevated)",
              color: "var(--cl-text-secondary)",
              lineHeight: 1.5,
            }}
          >
            {JSON.stringify(entry.params, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}
