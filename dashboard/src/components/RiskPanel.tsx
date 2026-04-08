import { useState, useRef, useEffect } from "react";
import type { EntryResponse, RiskTrendPoint } from "../lib/types";
import { riskTierFromScore, riskColorRaw, entryIcon } from "../lib/utils";
import { describeEntry } from "../lib/groupEntries";
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
  const icon = entryIcon(entry);
  const tier = entry.riskScore != null ? riskTierFromScore(entry.riskScore) : "low";
  const color = riskColorRaw(tier);
  const description = describeEntry(entry);
  const hasAi = entry.llmEvaluation && entry.llmEvaluation.confidence !== "none";

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left rounded-lg transition-colors"
        style={{
          backgroundColor: expanded ? "var(--cl-elevated)" : "transparent",
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
    </div>
  );
}
