// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import FilterRail from "../dashboard/src/components/activity/FilterRail";
import type { Filters } from "../dashboard/src/lib/activityFilters";
import type { ActivityCategory, AgentInfo, EntryResponse } from "../dashboard/src/lib/types";

const NOW = new Date("2026-04-26T18:00:00.000Z").getTime();

function entry(overrides: Partial<EntryResponse>): EntryResponse {
  return {
    timestamp: new Date(NOW - 30 * 60_000).toISOString(),
    toolName: "exec",
    params: {},
    effectiveDecision: "allow",
    category: "scripts" as ActivityCategory,
    ...overrides,
  };
}

function agent(id: string): AgentInfo {
  return {
    id,
    name: id,
    status: "active",
    todayToolCalls: 1,
    avgRiskScore: 30,
    peakRiskScore: 50,
    lastActiveTimestamp: new Date(NOW).toISOString(),
    mode: "interactive",
    riskPosture: "calm",
    activityBreakdown: {
      exploring: 0,
      changes: 0,
      git: 0,
      scripts: 0,
      web: 0,
      comms: 0,
      orchestration: 0,
      media: 0,
    },
    todayActivityBreakdown: {
      exploring: 0,
      changes: 0,
      git: 0,
      scripts: 0,
      web: 0,
      comms: 0,
      orchestration: 0,
      media: 0,
    },
    needsAttention: false,
    blockedCount: 0,
    riskProfile: { low: 0, medium: 0, high: 0, critical: 0 },
    todayRiskMix: { low: 0, medium: 0, high: 0, critical: 0 },
    hourlyActivity: [],
  };
}

const AGENTS: AgentInfo[] = [agent("baddie"), agent("seo-growth")];

const COUNT_BASIS: EntryResponse[] = [
  entry({
    toolCallId: "1",
    agentId: "baddie",
    riskTier: "critical",
    category: "scripts",
    effectiveDecision: "block",
  }),
  entry({
    toolCallId: "2",
    agentId: "baddie",
    riskTier: "high",
    category: "git",
    effectiveDecision: "allow",
  }),
  entry({
    toolCallId: "3",
    agentId: "seo-growth",
    riskTier: "low",
    category: "exploring",
    effectiveDecision: "allow",
  }),
  entry({
    toolCallId: "4",
    agentId: "seo-growth",
    riskTier: "medium",
    category: "scripts",
    effectiveDecision: "pending",
  }),
  entry({
    toolCallId: "5",
    agentId: "baddie",
    riskTier: "high",
    category: "scripts",
    effectiveDecision: "allow",
  }),
];

function setup(initial?: Partial<Filters>) {
  const onSelect = vi.fn();
  const onClear = vi.fn();
  const onApplyFilters = vi.fn();
  const utils = render(
    <FilterRail
      filters={initial ?? {}}
      agents={AGENTS}
      countBasis={COUNT_BASIS}
      onSelect={onSelect}
      onClear={onClear}
      onApplyFilters={onApplyFilters}
    />,
  );
  return { ...utils, onSelect, onClear, onApplyFilters };
}

describe("FilterRail — group rendering", () => {
  it("renders all 5 group labels (agent, risk, category, decision, time)", () => {
    setup();
    for (const label of ["agent", "risk", "category", "decision", "time"]) {
      expect(screen.getByTestId(`filter-group-${label}`)).toBeInTheDocument();
    }
  });

  it("renders one row per agent in the agent group", () => {
    setup();
    const group = screen.getByTestId("filter-group-agent");
    expect(within(group).getByTestId("filter-row-agent-baddie")).toBeInTheDocument();
    expect(within(group).getByTestId("filter-row-agent-seo-growth")).toBeInTheDocument();
  });

  it("renders four risk options in design order (crit/high/med/low)", () => {
    setup();
    const group = screen.getByTestId("filter-group-risk");
    const rows = within(group).getAllByTestId(/^filter-row-tier-/);
    expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual([
      "filter-row-tier-critical",
      "filter-row-tier-high",
      "filter-row-tier-medium",
      "filter-row-tier-low",
    ]);
  });

  it("renders the search-within-filters input", () => {
    setup();
    expect(screen.getByPlaceholderText("search filters")).toBeInTheDocument();
  });
});

describe("FilterRail — counts", () => {
  it("shows the count of matching entries on each option (given other filters)", () => {
    setup();
    // baddie has 3 entries in COUNT_BASIS; seo-growth has 2.
    const baddieRow = screen.getByTestId("filter-row-agent-baddie");
    expect(baddieRow.textContent).toContain("3");
    const seoRow = screen.getByTestId("filter-row-agent-seo-growth");
    expect(seoRow.textContent).toContain("2");
  });

  it("counts respect the other active filters", () => {
    setup({ tier: "high" });
    // With tier=high active: 2 entries (toolCallIds 2 + 5), both baddie.
    const baddieRow = screen.getByTestId("filter-row-agent-baddie");
    expect(baddieRow.textContent).toContain("2");
    const seoRow = screen.getByTestId("filter-row-agent-seo-growth");
    expect(seoRow.textContent).toContain("0");
  });

  it("shows 0 for an option with no matches", () => {
    setup({ category: "comms" });
    // No entries are in 'comms'; every agent count is 0.
    const baddieRow = screen.getByTestId("filter-row-agent-baddie");
    expect(baddieRow.textContent).toContain("0");
  });

  it("currently-active option always shows its row count, even when 0", () => {
    // agent=baddie + category=comms — no entries match. The active baddie row
    // must still render its (zero) count so the operator sees what's selected.
    setup({ agent: "baddie", category: "comms" });
    const baddieRow = screen.getByTestId("filter-row-agent-baddie");
    expect(baddieRow.textContent).toContain("0");
  });
});

describe("FilterRail — disabled state", () => {
  it("zero-count options render disabled (opacity 0.55, cursor default)", () => {
    setup({ category: "comms" });
    // Every agent count is 0 here. Both rows must be disabled.
    const baddieBtn = screen.getByTestId("filter-row-agent-baddie") as HTMLButtonElement;
    expect(baddieBtn).toBeDisabled();
    expect(baddieBtn.style.cursor).toBe("default");
    expect(parseFloat(baddieBtn.style.opacity)).toBeCloseTo(0.55, 2);
  });

  it("active option is NOT disabled even when its count is 0", () => {
    setup({ agent: "baddie", category: "comms" });
    // Under category=comms, agent=baddie still shows the row, count 0,
    // but since it's the active selection, must remain enabled so the user
    // can click it again to clear.
    const baddieBtn = screen.getByTestId("filter-row-agent-baddie") as HTMLButtonElement;
    expect(baddieBtn).not.toBeDisabled();
    expect(baddieBtn.style.cursor).not.toBe("default");
  });
});

describe("FilterRail — interaction", () => {
  it("clicking an option calls onSelect(key, value)", () => {
    const { onSelect } = setup();
    fireEvent.click(screen.getByTestId("filter-row-agent-baddie"));
    expect(onSelect).toHaveBeenCalledWith("agent", "baddie");
  });

  it("clicking the same active option also calls onSelect — parent handles toggle", () => {
    const { onSelect } = setup({ agent: "baddie" });
    fireEvent.click(screen.getByTestId("filter-row-agent-baddie"));
    // Component never short-circuits; parent decides set vs. clear based on prior value.
    expect(onSelect).toHaveBeenCalledWith("agent", "baddie");
  });

  it("group CLEAR link is hidden when the group has no active filter", () => {
    setup();
    expect(screen.queryByTestId("filter-clear-agent")).toBeNull();
  });

  it("group CLEAR link appears when the group has an active filter and calls onClear", () => {
    const { onClear } = setup({ agent: "baddie" });
    const clearBtn = screen.getByTestId("filter-clear-agent");
    fireEvent.click(clearBtn);
    expect(onClear).toHaveBeenCalledWith("agent");
  });
});

describe("FilterRail — collapse / expand", () => {
  it("clicking a group header toggles collapse; rows hide when collapsed", () => {
    setup();
    const header = screen.getByTestId("filter-group-header-agent");
    expect(screen.getByTestId("filter-row-agent-baddie")).toBeInTheDocument();
    fireEvent.click(header);
    expect(screen.queryByTestId("filter-row-agent-baddie")).toBeNull();
    fireEvent.click(header);
    expect(screen.getByTestId("filter-row-agent-baddie")).toBeInTheDocument();
  });
});

describe("FilterRail — search-within-filters", () => {
  it("typing narrows visible options by case-insensitive substring", () => {
    setup();
    const input = screen.getByPlaceholderText("search filters");
    fireEvent.change(input, { target: { value: "BAD" } });
    expect(screen.getByTestId("filter-row-agent-baddie")).toBeInTheDocument();
    expect(screen.queryByTestId("filter-row-agent-seo-growth")).toBeNull();
  });
});
