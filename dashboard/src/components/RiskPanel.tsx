import { useState, useRef, useEffect } from "react";
import type { EntryResponse, RiskTrendPoint } from "../lib/types";
import { riskTierFromScore, riskColorRaw, riskLeftBorder, entryIcon } from "../lib/utils";
import { describeEntry } from "../lib/groupEntries";
import GuardrailModal from "./GuardrailModal";
import Sparkline from "./Sparkline";
import RiskDetail from "./RiskDetail";

interface DedupedRisk {
  entry: EntryResponse;
  count: number;
}

interface Props {
  riskTrend: RiskTrendPoint[];
  topRisks: DedupedRisk[];
  onDotClick?: (point: RiskTrendPoint, index: number) => void;
}

export default function RiskPanel({ riskTrend, topRisks, onDotClick }: Props) {
  const sparkRef = useRef<HTMLDivElement>(null);
  const [sparkWidth, setSparkWidth] = useState(320);

  useEffect(() => {
    const el = sparkRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setSparkWidth(entry.contentRect.width);
      }
    });
    observer.observe(el);
    setSparkWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);

  return (
    <div>
      {/* Top risks */}
      <h3 className="label-mono mb-3" style={{ color: "var(--cl-text-muted)" }}>
        TOP RISKS
      </h3>

      {topRisks.length === 0 ? (
        <p className="text-sm py-4" style={{ color: "var(--cl-text-muted)" }}>
          No elevated risks in recent activity
        </p>
      ) : (
        <div className="space-y-1 mb-6">
          {topRisks.map(({ entry, count }, i) => (
            <RiskDriverRow key={entry.toolCallId ?? i} entry={entry} count={count} />
          ))}
        </div>
      )}

      {/* Trend */}
      <div className="cl-divider mb-4" />
      <h3 className="label-mono mb-3" style={{ color: "var(--cl-text-muted)" }}>
        TREND
      </h3>
      <div ref={sparkRef}>
        <Sparkline points={riskTrend} width={sparkWidth} height={100} onDotClick={onDotClick} />
      </div>
    </div>
  );
}

function RiskDriverRow({ entry, count }: { entry: EntryResponse; count?: number }) {
  const [expanded, setExpanded] = useState(false);
  const [showGuardrailModal, setShowGuardrailModal] = useState(false);
  const icon = entryIcon(entry);
  const tier = entry.riskScore != null ? riskTierFromScore(entry.riskScore) : "low";
  const color = riskColorRaw(tier);
  const description = describeEntry(entry);
  const hasAi = entry.llmEvaluation && entry.llmEvaluation.confidence !== "none";

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="group w-full flex items-center gap-2.5 px-3 py-2.5 text-left rounded-lg transition-colors"
        style={{
          backgroundColor: expanded ? "var(--cl-elevated)" : "transparent",
          boxShadow: riskLeftBorder(entry.riskScore),
        }}
      >
        {/* Category icon */}
        <svg
          width="14"
          height="14"
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

        {/* Count badge */}
        {count != null && count > 1 && (
          <span className="label-mono shrink-0" style={{ color: "var(--cl-text-muted)" }}>
            &times;{count}
          </span>
        )}

        {/* Risk score + tier */}
        {entry.riskScore != null && (
          <span className="flex items-center gap-1.5 shrink-0">
            <span className="font-mono text-xs" style={{ color: "var(--cl-text-secondary)" }}>
              {entry.riskScore}
            </span>
            <span className="label-mono" style={{ color }}>
              {tier.toUpperCase()}
            </span>
          </span>
        )}

        {/* AI label */}
        {hasAi && (
          <span
            className="label-mono shrink-0"
            style={{ color: "var(--cl-accent)", fontSize: "10px" }}
          >
            AI
          </span>
        )}

        {/* Guardrail badge */}
        {entry.guardrailMatch && (
          <span className="shrink-0" title={`Guardrail: ${entry.guardrailMatch.action.type}`}>
            <svg
              width="12"
              height="12"
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
              width="12"
              height="12"
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

        {/* Chevron */}
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

      {/* AI reasoning preview (collapsed) */}
      {!expanded && entry.llmEvaluation?.reasoning && (
        <div
          className="text-xs italic px-3 pb-1 truncate"
          style={{ color: "var(--cl-text-muted)", paddingLeft: "2.25rem" }}
        >
          &ldquo;{entry.llmEvaluation.reasoning}&rdquo;
        </div>
      )}

      {/* Expandable RiskDetail */}
      <div
        className="grid transition-all"
        style={{
          gridTemplateRows: expanded ? "1fr" : "0fr",
          transitionDuration: "var(--cl-spring-duration)",
          transitionTimingFunction: "var(--cl-spring)",
        }}
      >
        <div className="overflow-hidden">
          <div className="px-3 pb-3 pl-8">
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
