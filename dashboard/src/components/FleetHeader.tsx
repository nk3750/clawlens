import { useTotalFlash } from "../hooks/useTotalFlash";
import type { StatsResponse } from "../lib/types";
import DateChip from "./fleetheader/DateChip";
import RiskMixDonut from "./fleetheader/RiskMixDonut";
import { computeTrend, type RangeOption, splitAgentsRunning } from "./fleetheader/utils";

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
        <RiskMixCard breakdown={stats.riskBreakdown} />
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

function StatCardShell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="cl-card"
      style={{
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        minHeight: 132,
      }}
    >
      <span
        className="label-mono"
        style={{
          letterSpacing: "0.04em",
          color: "var(--cl-text-muted)",
        }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

const BIG_NUMBER_STYLE: React.CSSProperties = {
  fontFamily: "var(--cl-font-sans)",
  fontSize: 48,
  fontWeight: 510,
  lineHeight: 1,
  letterSpacing: "-1.056px",
  color: "var(--cl-text-primary)",
  fontVariantNumeric: "tabular-nums",
};

const SUBLABEL_STYLE: React.CSSProperties = {
  fontFamily: "var(--cl-font-sans)",
  fontSize: 14,
  fontWeight: 400,
  color: "var(--cl-text-muted)",
};

const SECONDARY_LINE_STYLE: React.CSSProperties = {
  fontFamily: "var(--cl-font-sans)",
  fontSize: 13,
  fontWeight: 400,
  color: "var(--cl-text-muted)",
};

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

function AgentsRunningCard({
  active,
  activeSessions,
  total,
}: {
  active: number;
  activeSessions: number;
  total: number;
}) {
  const pct = total > 0 ? Math.round((active / total) * 100) : 0;
  const idle = Math.max(0, total - active);
  const { betweenSessions } = splitAgentsRunning(active, activeSessions);

  return (
    <StatCardShell label="AGENTS RUNNING">
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={BIG_NUMBER_STYLE}>{active}</span>
        <span style={SUBLABEL_STYLE}>/{pct}%</span>
      </div>
      <span style={SECONDARY_LINE_STYLE}>
        of {total}
        {idle > 0 ? ` · ${idle} idle` : ""}
        {betweenSessions > 0 ? ` · ${betweenSessions} between` : ""}
      </span>
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

function RiskMixCard({
  breakdown,
}: {
  breakdown: StatsResponse["riskBreakdown"];
}) {
  return (
    <StatCardShell label="RISK MIX · 24H">
      <div style={{ display: "flex", alignItems: "center" }}>
        <RiskMixDonut
          crit={breakdown.critical}
          high={breakdown.high}
          medium={breakdown.medium}
          low={breakdown.low}
        />
      </div>
    </StatCardShell>
  );
}
