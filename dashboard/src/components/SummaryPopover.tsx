import { Fragment, useEffect, useRef } from "react";
import { Link } from "react-router-dom";

interface Props {
  /** Resolved summary text. `null` while idle/closed; `null` + loading=true while fetching. */
  summary: string | null;
  /** True while the upstream LLM call is in flight. Drives the loading skeleton. */
  loading: boolean;
  /** Used to build the `Open agent →` click-through. */
  agentId: string;
  /** Card owns popoverOpen state; popover signals dismiss intent up. */
  onClose: () => void;
}

const WORD_STAGGER_MS = 30;

/**
 * Click-anchored popover that surfaces the LLM-generated session summary for
 * an agent card. Mirrors RiskMixPopover's chrome (cl-card + depth-pop + page-
 * fade-in) but anchors above + flush-right of the trigger because the summarize
 * button lives in the card's bottom row — anchoring `top` would push the
 * popover off the card's outer edge.
 *
 * Pure presentation: the card owns popoverOpen, summary state, and the
 * fetchSummary call. Dismiss intents (Esc, outside-click) are signalled via
 * onClose. Tests render this component in isolation with controlled props.
 */
export default function SummaryPopover({ summary, loading, agentId, onClose }: Props) {
  const popRef = useRef<HTMLDivElement>(null);

  // Esc + outside-click dismiss. Lifted from RiskMixMicrobar's pattern.
  // The popover only mounts when the card flips popoverOpen=true, so the
  // listener lifecycle matches the open lifecycle without internal gating.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onMouseDown = (e: MouseEvent) => {
      const node = popRef.current;
      if (!node) return;
      if (!node.contains(e.target as Node)) onClose();
    };

    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [onClose]);

  const targetHref = `/agent/${encodeURIComponent(agentId)}`;
  const words = summary ? summary.split(/\s+/).filter((w) => w.length > 0) : [];
  // Show body only when we have summary text and we're not actively re-fetching.
  // Skeleton covers both "fetch in flight" and "post-mount pre-fetch frame"
  // (parent batches setPopoverOpen + generate so loading flips true synchronously
  // in real usage; the OR keeps test mocks that hold loading=false also
  // displaying the skeleton until summary lands).
  const showBody = summary !== null && !loading;

  return (
    <div
      ref={popRef}
      role="tooltip"
      aria-live="polite"
      data-cl-summary-popover
      className="cl-card"
      style={{
        position: "absolute",
        // Anchor above the trigger so the popover overlays the card body, not
        // the empty space below the card.
        bottom: "calc(100% + 6px)",
        right: 0,
        width: 280,
        padding: "10px 12px",
        borderRadius: "var(--cl-r-md)",
        boxShadow: "var(--cl-depth-pop)",
        backgroundColor: "var(--cl-bg-card, var(--cl-bg))",
        border: "1px solid var(--cl-border)",
        zIndex: "var(--cl-z-tooltip)" as unknown as number,
        animation: "page-fade-in 120ms var(--cl-ease) both",
      }}
    >
      <div
        data-cl-summary-pop-header
        style={{
          color: "var(--cl-text-secondary)",
          fontFamily: "var(--cl-font-mono)",
          fontFeatureSettings: "normal",
          fontSize: 10,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          marginBottom: 8,
        }}
      >
        SUMMARY · TODAY
      </div>

      {!showBody ? (
        <div
          data-cl-summary-loading
          style={{ display: "flex", flexDirection: "column", gap: 6 }}
        >
          <div className="skeleton" style={{ height: 10, width: "92%" }} />
          <div className="skeleton" style={{ height: 10, width: "68%" }} />
        </div>
      ) : (
        <div
          data-cl-summary-body
          style={{
            color: "var(--cl-text-primary)",
            fontFamily: "var(--cl-font-sans)",
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          {words.map((word, i) => (
            // Words are stable for a given summary; index keys are safe here
            // because the summary string never partially mutates.
            //
            // The inter-word space is a sibling text node (Fragment child),
            // not part of the span's textContent — keeps each word's reveal
            // animation clean and lets tests assert word.textContent === "Three"
            // without trailing whitespace.
            // biome-ignore lint/suspicious/noArrayIndexKey: stable per render
            <Fragment key={`w-${i}`}>
              <span
                className="cl-summary-word"
                style={{ animationDelay: `${i * WORD_STAGGER_MS}ms` }}
              >
                {word}
              </span>
              {i < words.length - 1 ? " " : null}
            </Fragment>
          ))}
        </div>
      )}

      <div
        style={{
          height: 1,
          backgroundColor: "var(--cl-border)",
          margin: "8px 0",
        }}
      />

      <Link
        data-cl-summary-pop-link
        to={targetHref}
        // The popover sits inside the card's outer <Link to="/agent/:id">.
        // stopPropagation so clicking the footer doesn't double-fire the
        // outer card navigation (same pattern as RiskMixPopover's link).
        onClick={(e) => {
          e.stopPropagation();
        }}
        style={{
          color: "var(--cl-accent)",
          fontFamily: "var(--cl-font-mono)",
          fontFeatureSettings: "normal",
          fontSize: 11,
          textDecoration: "none",
          display: "inline-block",
        }}
      >
        Open agent →
      </Link>
    </div>
  );
}
