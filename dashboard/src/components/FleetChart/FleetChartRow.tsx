import type { AgentInfo, TimelineSession } from "../../lib/types";
import type { ChannelMeta } from "../../lib/channel-catalog";
import type { RangeOption } from "../fleetheader/utils";
import FleetChartIdentity from "./FleetChartIdentity";
import FleetChartTimelineStrip from "./FleetChartTimelineStrip";
import FleetChartDayGrid from "./FleetChartDayGrid";
import FleetChartTotals from "./FleetChartTotals";
import {
  ROW_HEIGHT_COMPACT,
  ROW_HEIGHT_EXPANDED,
  type Cluster,
  type DayBucket,
} from "./utils";

interface Props {
  agent: AgentInfo;
  range: RangeOption;
  isToday: boolean;
  mobile: boolean;
  sessions: TimelineSession[];
  scheduleLabel: string | null;
  channels: ChannelMeta[];
  pendingSessionKeys: ReadonlySet<string>;
  breathingRingKeys: ReadonlySet<string>;
  ghostNextRunMs: number | null;
  startMs: number;
  endMs: number;
  nowMs: number;
  days: DayBucket[];
  maxDayActions: number;
  todayIso: string;
  isDimmed: boolean;
  /** Passed only to the first rendered row so the ▼ + NOW caption attaches
   *  inside that row's strip and inherits its correctly-measured width. */
  showNowCap?: boolean;
  onHoverRow: (agentId: string | null) => void;
  onHoverCluster: (
    c: Cluster | null,
    event: React.MouseEvent<SVGGElement> | null,
  ) => void;
  onClickCluster: (c: Cluster, event: React.MouseEvent<SVGGElement>) => void;
  onHoverDay: (
    bucket: DayBucket | null,
    agentId: string,
    event: React.MouseEvent<SVGGElement> | null,
  ) => void;
  onClickDay: (
    bucket: DayBucket,
    agentId: string,
    event: React.MouseEvent<SVGGElement>,
  ) => void;
}

function secondaryLineNeeded(
  scheduleLabel: string | null,
  agent: AgentInfo,
  channels: ChannelMeta[],
): boolean {
  if (scheduleLabel) return true;
  if (agent.status === "idle" && agent.lastActiveTimestamp) return true;
  const nonDefault = channels.filter(
    (c) => c.id !== "main" && c.id !== "unknown",
  );
  return nonDefault.length > 0;
}

export default function FleetChartRow({
  agent,
  range,
  isToday,
  mobile,
  sessions,
  scheduleLabel,
  channels,
  pendingSessionKeys,
  breathingRingKeys,
  ghostNextRunMs,
  startMs,
  endMs,
  nowMs,
  days,
  maxDayActions,
  todayIso,
  isDimmed,
  showNowCap = false,
  onHoverRow,
  onHoverCluster,
  onClickCluster,
  onHoverDay,
  onClickDay,
}: Props) {
  const rowIsEmpty = sessions.length === 0 && agent.status !== "active";
  const rowHeight =
    mobile || !secondaryLineNeeded(scheduleLabel, agent, channels)
      ? ROW_HEIGHT_COMPACT
      : ROW_HEIGHT_EXPANDED;

  return (
    <div
      className="fleet-row flex items-stretch"
      style={{
        height: rowHeight,
        opacity: isDimmed ? 0.3 : rowIsEmpty ? 0.55 : 1,
        transition: "opacity 0.2s",
      }}
      onMouseEnter={() => onHoverRow(agent.id)}
      onMouseLeave={() => onHoverRow(null)}
      data-cl-fleet-row
      data-cl-agent={agent.id}
    >
      <FleetChartIdentity
        agent={agent}
        scheduleLabel={scheduleLabel}
        channels={channels}
        mobile={mobile}
      />
      <div
        className="flex-1 min-w-0 flex items-center"
        style={{ height: rowHeight }}
        data-cl-fleet-middle
      >
        {range === "7d" ? (
          <FleetChartDayGrid
            agentId={agent.id}
            days={days}
            maxActions={maxDayActions}
            todayIso={todayIso}
            height={rowHeight}
            onHover={(bucket, event) => onHoverDay(bucket, agent.id, event)}
            onClick={(bucket, event) => onClickDay(bucket, agent.id, event)}
          />
        ) : (
          <FleetChartTimelineStrip
            range={range}
            agentSessions={sessions}
            pendingSessionKeys={pendingSessionKeys}
            breathingRingKeys={breathingRingKeys}
            ghostNextRunMs={ghostNextRunMs}
            startMs={startMs}
            endMs={endMs}
            nowMs={nowMs}
            isToday={isToday}
            height={rowHeight}
            showNowCap={showNowCap}
            onHover={onHoverCluster}
            onClick={onClickCluster}
          />
        )}
      </div>
      <FleetChartTotals
        agent={agent}
        sessions={sessions}
        isToday={isToday}
        mobile={mobile}
      />
    </div>
  );
}
