import { useState } from "react";
import GradientAvatar from "../GradientAvatar";
import FilterGroup from "../activity/FilterGroup";
import FilterRow from "../activity/FilterRow";
import { riskColorRaw } from "../../lib/utils";
import type { SessionFilters } from "../../lib/sessionFilters";
import type { AgentInfo, RiskTier } from "../../lib/types";

interface Props {
  filters: SessionFilters;
  agents: AgentInfo[];
  onSelect: (key: keyof SessionFilters, value: string) => void;
  onClear: (key: keyof SessionFilters) => void;
  isMobile?: boolean;
}

const TIER_ORDER: RiskTier[] = ["critical", "high", "medium", "low"];
const DURATION_OPTIONS: { value: "lt1m" | "1to10m" | "gt10m"; label: string }[] = [
  { value: "lt1m", label: "<1m" },
  { value: "1to10m", label: "1–10m" },
  { value: "gt10m", label: "10m+" },
];
const TIME_OPTIONS: { value: "1h" | "6h" | "24h" | "7d"; label: string }[] = [
  { value: "1h", label: "last 1 hour" },
  { value: "6h", label: "last 6 hours" },
  { value: "24h", label: "last 24 hours" },
  { value: "7d", label: "last 7 days" },
];

type GroupKey = "agent" | "risk" | "duration" | "since";

/**
 * Sessions filter rail (spec §5.6). Reuses the activity-page primitives
 * (`FilterGroup`, `FilterRow`) for visual parity but ships with no search
 * input (§11.5) and no saved-searches group (§11.6).
 */
export default function SessionsFilterRail({
  filters,
  agents,
  onSelect,
  onClear,
  isMobile = false,
}: Props) {
  const [collapsed, setCollapsed] = useState<Record<GroupKey, boolean>>({
    agent: false,
    risk: false,
    duration: false,
    since: false,
  });
  const toggle = (k: GroupKey) => setCollapsed((c) => ({ ...c, [k]: !c[k] }));

  const renderRow = (
    key: keyof SessionFilters,
    value: string,
    activeValue: string | undefined,
    children: React.ReactNode,
    testId: string,
  ) => {
    const isActive = activeValue === value;
    return (
      <FilterRow
        key={value}
        active={isActive}
        disabled={false}
        onClick={() => onSelect(key, value)}
        testId={testId}
      >
        {children}
      </FilterRow>
    );
  };

  const railStyle: React.CSSProperties = isMobile
    ? { padding: "18px 14px 28px", height: "100%" }
    : {
        borderRight: "1px solid var(--cl-border-subtle)",
        padding: "18px 14px 28px",
        position: "sticky",
        top: 48,
        alignSelf: "start",
        maxHeight: "calc(100vh - 48px)",
        overflowY: "auto",
      };

  return (
    <aside data-testid="filter-rail" style={railStyle}>
      <FilterGroup
        groupKey="agent"
        label="agent"
        collapsed={collapsed.agent}
        onToggleCollapse={() => toggle("agent")}
        cleared={!!filters.agent}
        onClear={() => onClear("agent")}
      >
        {agents.map((a) =>
          renderRow(
            "agent",
            a.id,
            filters.agent,
            <>
              <GradientAvatar agentId={a.id} size="xs" />
              <span>{a.name}</span>
            </>,
            `filter-row-agent-${a.id}`,
          ),
        )}
      </FilterGroup>

      <FilterGroup
        groupKey="risk"
        label="avg risk"
        collapsed={collapsed.risk}
        onToggleCollapse={() => toggle("risk")}
        cleared={!!filters.risk}
        onClear={() => onClear("risk")}
      >
        {TIER_ORDER.map((tier) =>
          renderRow(
            "risk",
            tier,
            filters.risk,
            <>
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 999,
                  background: riskColorRaw(tier),
                }}
              />
              <span>{tier}</span>
            </>,
            `filter-row-risk-${tier}`,
          ),
        )}
      </FilterGroup>

      <FilterGroup
        groupKey="duration"
        label="duration"
        collapsed={collapsed.duration}
        onToggleCollapse={() => toggle("duration")}
        cleared={!!filters.duration}
        onClear={() => onClear("duration")}
      >
        {DURATION_OPTIONS.map((d) =>
          renderRow(
            "duration",
            d.value,
            filters.duration,
            <span>{d.label}</span>,
            `filter-row-duration-${d.value}`,
          ),
        )}
      </FilterGroup>

      <FilterGroup
        groupKey="since"
        label="since"
        collapsed={collapsed.since}
        onToggleCollapse={() => toggle("since")}
        cleared={!!filters.since}
        onClear={() => onClear("since")}
      >
        {TIME_OPTIONS.map((t) =>
          renderRow(
            "since",
            t.value,
            filters.since,
            <span>{t.label}</span>,
            `filter-row-since-${t.value}`,
          ),
        )}
      </FilterGroup>
    </aside>
  );
}
