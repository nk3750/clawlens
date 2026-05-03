import { useTotalFlash } from "../hooks/useTotalFlash";
import type { StatsResponse } from "../lib/types";
import AgentsRunningCard from "./fleetheader/AgentsRunningCard";
import {
  BIG_NUMBER_STYLE,
  SECONDARY_LINE_STYLE,
  StatCardShell,
  SUBLABEL_STYLE,
} from "./fleetheader/cardStyles";
import DateChip from "./fleetheader/DateChip";
import RiskMixTierRows from "./fleetheader/RiskMixTierRows";
import { computeTrend, type RangeOption } from "./fleetheader/utils";

interface Props {
  stats: StatsResponse;
  totalAgents: number;
  pendingCount: number;
  /** Names of agents that currently have a pending approval, for the
   *  PENDING APPROVAL card's secondary line. Order = newest first. */
  pendingAgentNames?: string[];
  selectedDate: string | null;
  onDateChange: (date: string | null) => void;
  /** Still needed for DateChip's "Last 7 days" span shortcut, which sets the
   *  range + date together. The range pill group itself moved to the chart
   *  header (issue #16). */
  onRangeChange: (range: RangeOption) => void;
  /** Optional retention string (e.g. "30d") from /api/config — clamps the calendar. */
  retention?: string | null;
}

/**
 * Linear-adjacent fleet header — two stacked strips.
 *   Top:    TODAY chip + (right) selected-date controls
 *   Bottom: 4-card stat grid — ACTIONS / AGENTS RUNNING / PENDING APPROVAL / RISK MIX · 24H
 *
 * Range-pill selection lives on the FleetChart header (issue #16). Liveness
 * is surfaced by the nav-bar gateway-health dot (issue #19); this header
 * no longer carries an SSE-status label.
 */
export default function FleetHeader({
  stats,
  totalAgents,
  pendingCount,
  pendingAgentNames,
  selectedDate,
  onDateChange,
  onRangeChange,
  retention,
}: Props) {
  return (
    <section aria-label="Fleet header" data-cl-fleet-header>
      <RangeChromeStrip
        selectedDate={selectedDate}
        onDateChange={onDateChange}
        onRangeChange={onRangeChange}
        retention={retention}
      />
      <div
        className="cl-fleet-stat-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 12,
          marginTop: 12,
        }}
      >
        <ActionsCard
          total={stats.total}
          yesterdayTotal={stats.yesterdayTotal}
        />
        <AgentsRunningCard
          active={stats.activeAgents}
          activeSessions={stats.activeSessions}
          total={totalAgents}
        />
        <PendingCard count={pendingCount} agentNames={pendingAgentNames ?? []} />
        <RiskMixTierRows breakdown={stats.riskBreakdown} />
      </div>
    </section>
  );
}

// ── Top strip ───────────────────────────────────────────────────────────

interface RangeChromeProps {
  selectedDate: string | null;
  onDateChange: (date: string | null) => void;
  onRangeChange: (range: RangeOption) => void;
  retention?: string | null;
}

function RangeChromeStrip({
  selectedDate,
  onDateChange,
  onRangeChange,
  retention,
}: RangeChromeProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 0",
        flexWrap: "wrap",
      }}
    >
      <DateChip
        selectedDate={selectedDate}
        onChange={onDateChange}
        onRangeChange={onRangeChange}
        retention={retention ?? null}
      />
    </div>
  );
}

// ── Stat cards ──────────────────────────────────────────────────────────

function ActionsCard({
  total,
  yesterdayTotal,
}: {
  total: number;
  yesterdayTotal: number;
}) {
  const flashing = useTotalFlash(total);
  const trend = computeTrend(total, yesterdayTotal);

  let trendNode: React.ReactNode = null;
  if (trend.kind === "up") {
    trendNode = (
      <span style={SECONDARY_LINE_STYLE}>
        <span style={{ color: "var(--cl-risk-low)", fontWeight: 510 }}>
          ↑ {trend.pct}%
        </span>{" "}
        vs yesterday
      </span>
    );
  } else if (trend.kind === "down") {
    trendNode = (
      <span style={SECONDARY_LINE_STYLE}>
        <span style={{ color: "var(--cl-risk-high)", fontWeight: 510 }}>
          ↓ {trend.pct}%
        </span>{" "}
        vs yesterday
      </span>
    );
  } else if (trend.kind === "same") {
    trendNode = <span style={SECONDARY_LINE_STYLE}>— same as yesterday</span>;
  } else if (trend.kind === "new") {
    trendNode = <span style={SECONDARY_LINE_STYLE}>first day tracking</span>;
  }

  return (
    <StatCardShell label="ACTIONS">
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span
          key={flashing ? `flash-${total}` : "rest"}
          className={flashing ? "cl-total-flash" : undefined}
          style={BIG_NUMBER_STYLE}
        >
          {total.toLocaleString()}
        </span>
        <span style={SUBLABEL_STYLE}>actions</span>
      </div>
      <div style={{ minHeight: 17 }}>{trendNode}</div>
    </StatCardShell>
  );
}

function PendingCard({
  count,
  agentNames,
}: {
  count: number;
  agentNames: string[];
}) {
  // Dedupe + cap to two names for the inline list; "+N more" catches the rest
  // so the card never overflows.
  const uniqueNames = Array.from(new Set(agentNames));
  const shown = uniqueNames.slice(0, 2);
  const extra = Math.max(0, uniqueNames.length - shown.length);

  let secondary: React.ReactNode;
  if (count === 0) {
    secondary = <span style={SECONDARY_LINE_STYLE}>none waiting</span>;
  } else if (shown.length === 0) {
    secondary = (
      <span style={SECONDARY_LINE_STYLE}>
        {count === 1 ? "1 action waiting" : `${count} actions waiting`}
      </span>
    );
  } else {
    secondary = (
      <span style={SECONDARY_LINE_STYLE}>
        {shown.join(" · ")}
        {extra > 0 ? ` · +${extra} more` : ""}
      </span>
    );
  }

  return (
    <StatCardShell label="PENDING APPROVAL">
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={BIG_NUMBER_STYLE}>{count}</span>
        <span style={SUBLABEL_STYLE}>
          {count === 1 ? "pending" : "pending"}
        </span>
      </div>
      <div style={{ minHeight: 17 }}>{secondary}</div>
    </StatCardShell>
  );
}
