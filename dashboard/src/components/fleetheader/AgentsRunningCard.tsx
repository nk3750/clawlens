import { BIG_NUMBER_STYLE, SECONDARY_LINE_STYLE, StatCardShell, SUBLABEL_STYLE } from "./cardStyles";
import { splitAgentsRunning } from "./utils";

/**
 * stat-cards-revamp-spec §4.2 — Agents Running card. Replaces the old
 * "{active}/{pct}%" slash with a discrete pip strip. At small fleet sizes
 * (total <= PIP_CAP) each pip represents one agent (1:1). Above that size,
 * the strip becomes a proportional bar of exactly PIP_CAP pips and the
 * secondary text carries the exact running/between/idle counts.
 */

interface Props {
  active: number;
  activeSessions: number;
  total: number;
}

/**
 * Maximum number of pips rendered in the strip. Above this fleet size, pips
 * become a proportional indicator rather than a 1:1 mapping. Tunable in live
 * walk per spec §8.2.
 */
export const PIP_CAP = 12;

const PIP_DIMENSIONS = {
  width: 6,
  height: 6,
  gap: 4,
} as const;

interface PipState {
  state: "active" | "idle";
}

function buildPips(active: number, total: number): PipState[] {
  if (total <= 0) return [];
  if (total <= PIP_CAP) {
    // 1:1 — first `active` pips green, rest dim. Defensive clamp on active.
    const greens = Math.max(0, Math.min(active, total));
    return Array.from({ length: total }, (_, i) => ({
      state: i < greens ? "active" : "idle",
    }));
  }
  // Proportional — exactly PIP_CAP pips. Round share to nearest pip; guard at
  // least one green when active > 0 so a non-empty fleet never reads "all idle".
  let greens = Math.round((active / total) * PIP_CAP);
  if (active > 0 && greens === 0) greens = 1;
  if (active >= total) greens = PIP_CAP;
  greens = Math.max(0, Math.min(greens, PIP_CAP));
  return Array.from({ length: PIP_CAP }, (_, i) => ({
    state: i < greens ? "active" : "idle",
  }));
}

export default function AgentsRunningCard({ active, activeSessions, total }: Props) {
  const { runningNow, betweenSessions } = splitAgentsRunning(active, activeSessions);
  const idle = Math.max(0, total - active);
  const pips = buildPips(active, total);

  return (
    <StatCardShell label="AGENTS RUNNING">
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span data-cl-agents-big style={BIG_NUMBER_STYLE}>
          {active}
        </span>
        <span data-cl-agents-sublabel style={SUBLABEL_STYLE}>
          of {total}
        </span>
      </div>

      {pips.length > 0 ? (
        <div
          data-cl-pip-strip
          role="img"
          aria-label={`${active} of ${total} agents active`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: PIP_DIMENSIONS.gap,
            minHeight: PIP_DIMENSIONS.height,
          }}
        >
          {pips.map((pip, i) => (
            <span
              key={i}
              data-cl-pip
              data-cl-pip-state={pip.state}
              aria-hidden="true"
              style={{
                width: PIP_DIMENSIONS.width,
                height: PIP_DIMENSIONS.height,
                borderRadius: "50%",
                background:
                  pip.state === "active" ? "var(--cl-risk-low)" : "var(--cl-bg-08)",
                boxShadow:
                  pip.state === "active"
                    ? "0 0 6px color-mix(in srgb, var(--cl-risk-low) 35%, transparent)"
                    : "none",
                flexShrink: 0,
              }}
            />
          ))}
        </div>
      ) : null}

      <span data-cl-agents-secondary style={SECONDARY_LINE_STYLE}>
        {runningNow} running · {betweenSessions} between · {idle} idle
      </span>
    </StatCardShell>
  );
}
