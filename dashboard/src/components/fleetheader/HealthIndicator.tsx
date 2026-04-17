import { useEffect, useState } from "react";
import { useSSEStatus } from "../../hooks/useSSEStatus";
import type { LlmHealthStatus } from "../../lib/types";
import {
  computeHealthState,
  formatHealthChromeLabel,
  formatHealthFooterLabel,
  healthDotColor,
  lagSeconds,
} from "./utils";

export type HealthIndicatorVariant = "chrome" | "footer";

interface Props {
  variant: HealthIndicatorVariant;
  /** Newest audit-entry timestamp from /api/stats. */
  lastEntryIso?: string | null;
  /** Snapshot of the LLM-health subsystem from /api/stats.llmHealth.status. */
  llmStatus?: LlmHealthStatus | null;
}

/**
 * Single shared health pill — renders as a compact dot+label in the fleet
 * header chrome and as a wider "SSE live" / "SSE stale" strip in the footer.
 *
 * Both variants drive off the same useSSEStatus hook plus the
 * lastEntryTimestamp from /api/stats. The component owns its own ticking
 * `now` so the lag value visibly counts up between SSE events.
 */
export default function HealthIndicator({ variant, lastEntryIso, llmStatus }: Props) {
  const sseStatus = useSSEStatus();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    // Re-render once a second so the lag display matches wall time without
    // relying on an external refetch.
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const lag = lagSeconds(lastEntryIso, now);
  const state = computeHealthState({
    sseStatus,
    lastEntryIso: lastEntryIso ?? undefined,
    llmStatus: llmStatus ?? undefined,
    nowMs: now,
  });
  const dot = healthDotColor(state);
  const label =
    variant === "chrome"
      ? formatHealthChromeLabel(state, lag)
      : formatHealthFooterLabel(state, lag);

  if (variant === "footer") {
    return (
      <span
        data-cl-health-variant="footer"
        className="flex items-center"
        style={{ gap: 6 }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: dot,
            boxShadow: `0 0 6px ${dot}`,
          }}
        />
        <span style={{ color: "var(--cl-text-secondary)" }}>{label}</span>
      </span>
    );
  }

  // Chrome variant — fits inside the fleet-header right cluster.
  return (
    <span
      data-cl-health-variant="chrome"
      className="cl-fh-chip inline-flex items-center"
      style={{
        gap: 6,
        padding: "4px 10px",
        borderRadius: "var(--cl-radius-sm, 6px)",
        border: "1px solid var(--cl-border-subtle)",
        background: "transparent",
        color: "var(--cl-text-secondary)",
      }}
      title={label}
    >
      <span
        aria-hidden="true"
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: dot,
          boxShadow: `0 0 6px ${dot}`,
          animation: state === "reconnecting" ? "pulse 1.6s ease-in-out infinite" : undefined,
        }}
      />
      <span className="font-mono" style={{ fontSize: 11 }}>
        {label}
      </span>
    </span>
  );
}
