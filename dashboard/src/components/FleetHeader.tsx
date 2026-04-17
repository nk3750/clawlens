import type { StatsResponse } from "../lib/types";
import ActionsStat from "./fleetheader/ActionsStat";
import AgentsRunning from "./fleetheader/AgentsRunning";
import BlockedChip from "./fleetheader/BlockedChip";
import DateChip from "./fleetheader/DateChip";
import HealthIndicator from "./fleetheader/HealthIndicator";
import OverflowMenu from "./fleetheader/OverflowMenu";
import PendingChip from "./fleetheader/PendingChip";
import PostureChip from "./fleetheader/PostureChip";
import RangePillGroup from "./fleetheader/RangePillGroup";
import {
  type RangeOption,
  shouldShowBlockedChip,
  shouldShowPendingChip,
} from "./fleetheader/utils";

interface Props {
  stats: StatsResponse;
  totalAgents: number;
  guardrailCount: number;
  pendingCount: number;
  selectedDate: string | null;
  onDateChange: (date: string | null) => void;
  range: RangeOption;
  onRangeChange: (range: RangeOption) => void;
  /** Optional retention string (e.g. "30d") from /api/config — clamps the calendar. */
  retention?: string | null;
}

/**
 * Single-row fleet header. Replaces FleetPulse. Three logical clusters:
 *   left   — date chip + range pills (temporal context)
 *   center — actions total + day-over-day trend
 *   right  — agents running, posture, blocked/pending (conditional), health, overflow
 *
 * Layout collapses at the breakpoints in spec §11; CSS in index.css owns the
 * actual flex/wrap rules so the component stays declarative.
 */
export default function FleetHeader({
  stats,
  totalAgents,
  guardrailCount,
  pendingCount,
  selectedDate,
  onDateChange,
  range,
  onRangeChange,
  retention,
}: Props) {
  const showBlocked = shouldShowBlockedChip(stats.blocked);
  const showPending = shouldShowPendingChip(pendingCount);

  return (
    <section
      className="cl-fleet-header stagger"
      aria-label="Fleet header"
      data-cl-fleet-header
    >
      <div className="cl-fh-left">
        <DateChip
          selectedDate={selectedDate}
          onChange={onDateChange}
          retention={retention ?? null}
        />
        <RangePillGroup value={range} onChange={onRangeChange} />
      </div>

      <div className="cl-fh-center">
        <ActionsStat
          total={stats.total}
          yesterdayTotal={stats.yesterdayTotal}
          weekAverage={stats.weekAverage}
          historicDailyMax={stats.historicDailyMax}
        />
      </div>

      <div className="cl-fh-right">
        <AgentsRunning
          active={stats.activeAgents}
          activeSessions={stats.activeSessions}
          total={totalAgents}
        />
        <PostureChip posture={stats.riskPosture} />
        {showBlocked && <BlockedChip count={stats.blocked} />}
        {showPending && <PendingChip count={pendingCount} />}
        <HealthIndicator
          variant="chrome"
          lastEntryIso={stats.lastEntryTimestamp ?? null}
          llmStatus={stats.llmHealth?.status ?? null}
        />
        <OverflowMenu
          guardrailCount={guardrailCount}
          selectedDate={selectedDate}
          rangeParam={range}
        />
      </div>
    </section>
  );
}
