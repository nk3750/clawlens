import { useState } from "react";
import type { EntryResponse } from "../lib/types";
import { relTime, riskTierFromScore, riskColorRaw, deriveTags, entryIcon } from "../lib/utils";
import DecisionBadge from "./DecisionBadge";
import GuardrailModal from "./GuardrailModal";
import RiskDetail from "./RiskDetail";

interface Props {
  entry: EntryResponse;
  /** Plain-language description */
  description: string;
}

export default function ActivityEntry({ entry, description }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [showGuardrailModal, setShowGuardrailModal] = useState(false);
  const icon = entryIcon(entry);

  const tier = entry.riskScore != null ? riskTierFromScore(entry.riskScore) : null;
  const dotColor = tier ? riskColorRaw(tier) : null;
  const showBadge = entry.effectiveDecision && entry.effectiveDecision !== "allow";
  const tags = deriveTags(entry);

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="group w-full flex items-center gap-3 px-4 py-3 text-left transition-colors"
        style={{
          backgroundColor: expanded ? "var(--cl-elevated)" : "transparent",
        }}
      >
        {/* Category icon (exec sub-category aware) */}
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke={icon.color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0"
        >
          <path d={icon.path} />
        </svg>

        {/* Description */}
        <span
          className="text-sm flex-1 min-w-0 truncate"
          style={{ color: "var(--cl-text-primary)" }}
        >
          {description}
        </span>

        {/* Inline tags */}
        {tags.length > 0 && (
          <span className="hidden md:flex items-center gap-1 shrink-0">
            {tags.map((tag) => (
              <span
                key={tag}
                className="label-mono px-1.5 py-0.5 rounded"
                style={{
                  fontSize: "11px",
                  backgroundColor: "var(--cl-accent-7)",
                  color: "var(--cl-text-secondary)",
                }}
              >
                {tag.toUpperCase()}
              </span>
            ))}
          </span>
        )}

        {/* Risk dot + score + tier */}
        {entry.riskScore != null && dotColor && tier && (
          <span className="flex items-center gap-1.5 shrink-0">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{
                backgroundColor: dotColor,
                boxShadow: tier !== "low" ? `0 0 6px ${dotColor}60` : undefined,
              }}
            />
            <span className="font-mono text-xs" style={{ color: "var(--cl-text-secondary)" }}>
              {entry.riskScore}
            </span>
            <span className="label-mono shrink-0" style={{ color: dotColor }}>
              {tier.toUpperCase()}
            </span>
            {entry.llmEvaluation && entry.llmEvaluation.confidence !== "none" && (
              <span
                className="label-mono shrink-0"
                style={{ color: "var(--cl-accent)", fontSize: "11px" }}
              >
                AI
              </span>
            )}
          </span>
        )}

        {/* Decision badge */}
        {showBadge && (
          <span className="shrink-0">
            <DecisionBadge decision={entry.effectiveDecision} />
          </span>
        )}

        {/* Guardrail badge */}
        {entry.guardrailMatch && (
          <span className="shrink-0" title={`Guardrail: ${entry.guardrailMatch.action.type}`}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke={
                entry.guardrailMatch.action.type === "block"
                  ? "#ef4444"
                  : entry.guardrailMatch.action.type === "require_approval"
                    ? "#fbbf24"
                    : "#4ade80"
              }
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </span>
        )}

        {/* Shield button — add guardrail */}
        {entry.toolCallId && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowGuardrailModal(true);
            }}
            className="shrink-0 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
            title="Add guardrail"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--cl-text-muted)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </button>
        )}

        {/* Timestamp */}
        <span className="font-mono text-xs shrink-0" style={{ color: "var(--cl-text-secondary)" }}>
          {relTime(entry.timestamp)}
        </span>

        {/* Expand chevron */}
        <svg
          width="14"
          height="14"
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

      {/* Expandable detail panel */}
      <div
        className="grid transition-all"
        style={{
          gridTemplateRows: expanded ? "1fr" : "0fr",
          transitionDuration: "var(--cl-spring-duration)",
          transitionTimingFunction: "var(--cl-spring)",
        }}
      >
        <div className="overflow-hidden">
          <div className="px-4 pb-4 pl-11">
            <RiskDetail entry={entry} />
          </div>
        </div>
      </div>

      {/* Guardrail creation modal */}
      {showGuardrailModal && (
        <GuardrailModal
          entry={entry}
          description={description}
          onClose={() => setShowGuardrailModal(false)}
          onCreated={() => {}}
        />
      )}
    </div>
  );
}
