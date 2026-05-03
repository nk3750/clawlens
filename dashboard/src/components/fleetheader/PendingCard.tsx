import type { ReactNode } from "react";
import { BIG_NUMBER_STYLE, SECONDARY_LINE_STYLE, StatCardShell, SUBLABEL_STYLE } from "./cardStyles";

/**
 * stat-cards-revamp-spec §4.3 — Pending Approval card.
 *
 * Two surgical changes from the previous inline rendering:
 *   1. The big-number color escalates on `count > 0` (accent indigo) and
 *      drops to muted on `count === 0`. Operators can answer "is there
 *      anything to act on?" without reading the digit.
 *   2. The empty-state secondary line shows a small green ✓ glyph and the
 *      affirmative copy "nothing waiting" — reads as ALL-CLEAR rather than
 *      the previous muted-grey-zero "none waiting".
 *
 * Existing rendering rules are preserved for regression: the agent-name
 * inline list (cap at 2 + " · +N more"), the dedupe step, and the
 * "1 action waiting" / "{count} actions waiting" fallback when count > 0
 * but agentNames is empty.
 *
 * No click handler on the card root; no CTA pill. The AttentionInbox below
 * the FleetHeader remains the action surface.
 */

interface Props {
  count: number;
  agentNames: string[];
}

function CheckGlyph() {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export default function PendingCard({ count, agentNames }: Props) {
  const isEmpty = count === 0;

  // Cap to two names for the inline list; "+N more" catches the rest so the
  // card never overflows. Dedupe first so duplicates from upstream don't
  // burn a slot.
  const uniqueNames = Array.from(new Set(agentNames));
  const shown = uniqueNames.slice(0, 2);
  const extra = Math.max(0, uniqueNames.length - shown.length);

  let secondary: ReactNode;
  if (isEmpty) {
    secondary = (
      <span
        data-cl-pending-secondary
        style={{
          ...SECONDARY_LINE_STYLE,
          color: "var(--cl-risk-low)",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <CheckGlyph />
        nothing waiting
      </span>
    );
  } else if (shown.length === 0) {
    secondary = (
      <span data-cl-pending-secondary style={SECONDARY_LINE_STYLE}>
        {count === 1 ? "1 action waiting" : `${count} actions waiting`}
      </span>
    );
  } else {
    secondary = (
      <span data-cl-pending-secondary style={SECONDARY_LINE_STYLE}>
        {shown.join(" · ")}
        {extra > 0 ? ` · +${extra} more` : ""}
      </span>
    );
  }

  return (
    <StatCardShell label="PENDING APPROVAL">
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span
          data-cl-pending-big
          data-cl-empty={isEmpty ? "true" : "false"}
          style={{
            ...BIG_NUMBER_STYLE,
            color: isEmpty ? "var(--cl-text-muted)" : "var(--cl-accent)",
          }}
        >
          {count}
        </span>
        <span style={SUBLABEL_STYLE}>pending</span>
      </div>
      <div style={{ minHeight: 17 }}>{secondary}</div>
    </StatCardShell>
  );
}
