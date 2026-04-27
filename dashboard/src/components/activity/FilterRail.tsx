import { useState } from "react";
import GradientAvatar from "../GradientAvatar";
import { CATEGORY_META, riskColorRaw } from "../../lib/utils";
import { countWith, type Filters } from "../../lib/activityFilters";
import type { ActivityCategory, AgentInfo, EntryResponse, RiskTier } from "../../lib/types";
import FilterGroup from "./FilterGroup";
import FilterRow from "./FilterRow";
import SavedSearchesGroup from "./SavedSearchesGroup";

interface Props {
  filters: Filters;
  agents: AgentInfo[];
  /**
   * Count basis: entries the rail computes counts against (24h window, no
   * filters). Stays stable as the user mutates filters so option counts
   * reflect "how many would match if I added this filter on top of what I've
   * already picked".
   */
  countBasis: EntryResponse[];
  onSelect: (key: keyof Filters, value: string) => void;
  onClear: (key: keyof Filters) => void;
  /**
   * Replace the entire filter set in one shot. Used by the saved-searches
   * group: clicking a saved row applies its full filter combo at once.
   */
  onApplyFilters: (next: Filters) => void;
  /**
   * Phase 2.9 (#37) — drawer mode. When true, the rail is rendered inside
   * a fixed-position drawer overlay; it drops its own sticky-aside top
   * offset so the inner content fills the drawer height instead of starting
   * 48px down from the top.
   */
  isMobile?: boolean;
}

const TIER_ORDER: RiskTier[] = ["critical", "high", "medium", "low"];
const CATEGORY_ORDER: ActivityCategory[] = [
  "exploring",
  "changes",
  "git",
  "scripts",
  "web",
  "comms",
  "orchestration",
  "media",
];
const DECISION_OPTIONS: { value: string; label: string }[] = [
  { value: "allow", label: "allowed" },
  { value: "block", label: "blocked" },
  { value: "approved", label: "approved" },
  { value: "denied", label: "denied" },
  { value: "pending", label: "pending" },
  { value: "timeout", label: "timeout" },
];
const TIME_OPTIONS: { value: string; label: string }[] = [
  { value: "1h", label: "last 1 hour" },
  { value: "6h", label: "last 6 hours" },
  { value: "24h", label: "last 24 hours" },
  { value: "7d", label: "last 7 days" },
];

type GroupKey = "agent" | "risk" | "category" | "decision" | "time";

export default function FilterRail({
  filters,
  agents,
  countBasis,
  onSelect,
  onClear,
  onApplyFilters,
  isMobile = false,
}: Props) {
  const [filterSearch, setFilterSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<GroupKey, boolean>>({
    agent: false,
    risk: false,
    category: false,
    decision: false,
    time: false,
  });
  const toggleCollapse = (k: GroupKey) =>
    setCollapsed((c) => ({ ...c, [k]: !c[k] }));

  const matchSearch = (s: string) =>
    !filterSearch || s.toLowerCase().includes(filterSearch.toLowerCase());

  const renderRow = (
    key: keyof Filters,
    value: string,
    activeValue: string | undefined,
    children: React.ReactNode,
    testId: string,
  ) => {
    const count = countWith(countBasis, { ...filters, [key]: value });
    const isActive = activeValue === value;
    const isDisabled = count === 0 && !isActive;
    return (
      <FilterRow
        key={value}
        active={isActive}
        disabled={isDisabled}
        onClick={() => onSelect(key, value)}
        testId={testId}
      >
        {children}
        <span style={{ flex: 1 }} />
        <span
          className="mono"
          style={{ fontSize: 10, color: "var(--cl-text-muted)" }}
        >
          {count}
        </span>
      </FilterRow>
    );
  };

  // In drawer mode, Activity.tsx wraps the rail in a fixed-position aside
  // overlay and applies its own scroll/positioning. The rail's own sticky
  // behavior would conflict (the outer wrapper is already fixed), so we
  // drop the sticky offset and run the rail at the natural flow height —
  // the wrapper provides the scroll viewport.
  const railStyle: React.CSSProperties = isMobile
    ? {
        padding: "18px 14px 28px",
        height: "100%",
      }
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
      {/* Search-within-filters input */}
      <div style={{ position: "relative", marginBottom: 14 }}>
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
          style={{
            position: "absolute",
            left: 8,
            top: "50%",
            transform: "translateY(-50%)",
            color: "var(--cl-text-muted)",
          }}
        >
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
        <input
          type="text"
          value={filterSearch}
          onChange={(e) => setFilterSearch(e.target.value)}
          placeholder="search filters"
          data-filter-search
          style={{
            width: "100%",
            height: 26,
            padding: "0 6px 0 24px",
            background: "var(--cl-bg-02)",
            border: "1px solid var(--cl-border-subtle)",
            borderRadius: 5,
            color: "var(--cl-text-primary)",
            fontSize: 11,
            outline: "none",
            fontFamily: "var(--cl-font-mono)",
          }}
        />
      </div>

      <SavedSearchesGroup
        filters={filters}
        countBasis={countBasis}
        onApplyFilters={onApplyFilters}
      />

      <FilterGroup
        groupKey="agent"
        label="agent"
        collapsed={collapsed.agent}
        onToggleCollapse={() => toggleCollapse("agent")}
        cleared={!!filters.agent}
        onClear={() => onClear("agent")}
      >
        {agents
          .filter((a) => matchSearch(a.name))
          .map((a) =>
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
        label="risk"
        collapsed={collapsed.risk}
        onToggleCollapse={() => toggleCollapse("risk")}
        cleared={!!filters.tier}
        onClear={() => onClear("tier")}
      >
        {TIER_ORDER.filter((t) => matchSearch(t)).map((tier) =>
          renderRow(
            "tier",
            tier,
            filters.tier,
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
            `filter-row-tier-${tier}`,
          ),
        )}
      </FilterGroup>

      <FilterGroup
        groupKey="category"
        label="category"
        collapsed={collapsed.category}
        onToggleCollapse={() => toggleCollapse("category")}
        cleared={!!filters.category}
        onClear={() => onClear("category")}
      >
        {CATEGORY_ORDER.filter((c) => matchSearch(CATEGORY_META[c].label)).map((cat) =>
          renderRow(
            "category",
            cat,
            filters.category,
            <>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke={CATEGORY_META[cat].color}
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ flexShrink: 0 }}
                aria-hidden="true"
              >
                <path d={CATEGORY_META[cat].iconPath} />
              </svg>
              <span>{CATEGORY_META[cat].label}</span>
            </>,
            `filter-row-category-${cat}`,
          ),
        )}
      </FilterGroup>

      <FilterGroup
        groupKey="decision"
        label="decision"
        collapsed={collapsed.decision}
        onToggleCollapse={() => toggleCollapse("decision")}
        cleared={!!filters.decision}
        onClear={() => onClear("decision")}
      >
        {DECISION_OPTIONS.filter((d) => matchSearch(d.label)).map((d) =>
          renderRow(
            "decision",
            d.value,
            filters.decision,
            <span>{d.label}</span>,
            `filter-row-decision-${d.value}`,
          ),
        )}
      </FilterGroup>

      <FilterGroup
        groupKey="time"
        label="time"
        collapsed={collapsed.time}
        onToggleCollapse={() => toggleCollapse("time")}
        cleared={!!filters.since}
        onClear={() => onClear("since")}
      >
        {TIME_OPTIONS.filter((t) => matchSearch(t.label)).map((t) =>
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
