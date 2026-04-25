import { useCallback, useEffect, useRef, useState } from "react";
import type { RiskTier } from "../lib/types";
import RiskMixPopover from "./RiskMixPopover";

interface Props {
  mix: Record<RiskTier, number>;
  /**
   * Canonical action-count denominator. Pass when `total` can diverge from
   * `sum(mix)` — e.g. when some entries lack a risk score, we still want the
   * bar's arc-length scaled against the footer's action count so the two
   * numbers stay visually consistent.
   */
  total?: number;
  /** Threaded into the popover's click-through `/activity?agent=<id>&tier=<worst>`. */
  agentId?: string;
}

// Severity-ordered draw: low first anchors the left (where most agents live),
// crit ends on the right so a 1-2% crit slice catches the eye against the
// low-tier mass rather than getting buried between medium and high.
const DRAW_ORDER: RiskTier[] = ["low", "medium", "high", "critical"];

const TIER_COLORS: Record<RiskTier, string> = {
  low: "var(--cl-risk-low)",
  medium: "var(--cl-risk-medium)",
  high: "var(--cl-risk-high)",
  critical: "var(--cl-risk-critical)",
};

const TIER_SHORT: Record<RiskTier, string> = {
  low: "low",
  medium: "med",
  high: "high",
  critical: "crit",
};

// Hover timings — 120ms defers briefly to absorb accidental cursor crossings
// without feeling sluggish (native title tooltips are ~1s, which was the
// exact UX problem we're fixing). 300ms on leave gives the cursor time to
// slide into the popover body without it vanishing mid-transit.
const SHOW_DELAY_MS = 120;
const HIDE_DELAY_MS = 300;

type LabelState =
  | { kind: "empty" }
  | { kind: "low"; count: number }
  | { kind: "medium"; count: number }
  | { kind: "high"; count: number }
  | { kind: "critical"; count: number };

/**
 * Derive the count-label state from the tier mix.
 *
 * Priority (top-down, first match wins): critical → high → medium → low.
 * The label surfaces the *worst tier present* and its count alone (e.g. for
 * { low: 100, high: 2 } → "2 high", not "102 high"). Vocabulary unified with
 * the agent-card pill (low/med/high/crit) to lock against future taxonomy
 * drift back to the legacy `elevated` / `high-risk` / `routine` strings.
 */
function deriveLabelState(mix: Record<RiskTier, number>, denominator: number): LabelState {
  if (denominator <= 0) return { kind: "empty" };
  if (mix.critical > 0) return { kind: "critical", count: mix.critical };
  if (mix.high > 0) return { kind: "high", count: mix.high };
  if (mix.medium > 0) return { kind: "medium", count: mix.medium };
  if (mix.low > 0) return { kind: "low", count: mix.low };
  return { kind: "empty" };
}

function labelText(state: LabelState): string | null {
  switch (state.kind) {
    case "critical":
      return `${state.count} ${TIER_SHORT.critical}`;
    case "high":
      return `${state.count} ${TIER_SHORT.high}`;
    case "medium":
      return `${state.count} ${TIER_SHORT.medium}`;
    case "low":
      return `${state.count} ${TIER_SHORT.low}`;
    case "empty":
      return null;
  }
}

function labelColor(state: LabelState): string {
  switch (state.kind) {
    case "critical":
      return "var(--cl-risk-critical)";
    case "high":
      return "var(--cl-risk-high)";
    case "medium":
      return "var(--cl-risk-medium)";
    case "low":
    case "empty":
      return "var(--cl-risk-low)";
  }
}

export default function RiskMixMicrobar({ mix, total, agentId }: Props) {
  const sum = mix.low + mix.medium + mix.high + mix.critical;
  const denominator = total ?? sum;

  const [popoverOpen, setPopoverOpen] = useState(false);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (showTimerRef.current) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const scheduleShow = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    if (popoverOpen || showTimerRef.current) return;
    showTimerRef.current = setTimeout(() => {
      showTimerRef.current = null;
      setPopoverOpen(true);
    }, SHOW_DELAY_MS);
  }, [popoverOpen]);

  const scheduleHide = useCallback(() => {
    if (showTimerRef.current) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    if (hideTimerRef.current) return;
    hideTimerRef.current = setTimeout(() => {
      hideTimerRef.current = null;
      setPopoverOpen(false);
    }, HIDE_DELAY_MS);
  }, []);

  // Esc closes the popover (keyboard parity with outside-click for modals).
  // Only subscribe while open to keep the document listener footprint small.
  useEffect(() => {
    if (!popoverOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        clearTimers();
        setPopoverOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [popoverOpen, clearTimers]);

  // Clean up any pending timers on unmount so a late-firing setTimeout can't
  // setState on a vanished component.
  useEffect(() => () => clearTimers(), [clearTimers]);

  // Nothing to show AND no promise of a stable layout slot → render nothing.
  // When `total` is provided we keep the track visible so the card layout
  // doesn't shift when scored entries arrive mid-render.
  if (denominator <= 0) return null;

  const summary = DRAW_ORDER.filter((t) => mix[t] > 0)
    .map((t) => `${TIER_SHORT[t]} ${mix[t]}`)
    .join(" · ");

  const state = deriveLabelState(mix, denominator);
  const label = labelText(state);

  return (
    <div
      data-cl-risk-mix-wrapper
      tabIndex={0}
      onMouseEnter={scheduleShow}
      onMouseLeave={scheduleHide}
      onFocus={scheduleShow}
      onBlur={scheduleHide}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        width: "100%",
        // Strip the default focus outline — the popover appearing on focus
        // is the signal; visible outline would clash with the bar's thin chrome.
        outline: "none",
      }}
    >
      <div
        data-cl-risk-mix-microbar
        role="img"
        aria-label={`risk mix today: ${summary}`}
        style={{
          display: "flex",
          flex: 1,
          height: 8,
          borderRadius: 4,
          overflow: "hidden",
          backgroundColor: "color-mix(in srgb, var(--cl-text-muted) 12%, transparent)",
        }}
      >
        {DRAW_ORDER.map((tier) => {
          const count = mix[tier];
          if (count <= 0) return null;
          const pct = (count / denominator) * 100;
          return (
            <div
              key={tier}
              data-cl-risk-mix-seg={tier}
              style={{
                width: `${pct}%`,
                backgroundColor: TIER_COLORS[tier],
              }}
            />
          );
        })}
      </div>
      {label && (
        <span
          data-cl-risk-mix-label
          className="tabular-nums shrink-0"
          style={{
            marginLeft: 10,
            color: labelColor(state),
            fontFamily: "var(--cl-font-mono)",
            fontFeatureSettings: "normal",
            fontSize: 11,
            letterSpacing: "0.02em",
          }}
        >
          {label}
        </span>
      )}
      {popoverOpen && agentId && (
        <div
          onMouseEnter={scheduleShow}
          onMouseLeave={scheduleHide}
          // The popover sits inside the card's outer <Link to="/agent/:id">.
          // We don't stopPropagation here — individual interactive children
          // (e.g. the click-through link) handle their own propagation.
        >
          <RiskMixPopover mix={mix} total={total} agentId={agentId} />
        </div>
      )}
    </div>
  );
}
