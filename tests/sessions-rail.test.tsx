// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SessionsFilterRail from "../dashboard/src/components/sessions/SessionsFilterRail";
import type { SessionFilters } from "../dashboard/src/lib/sessionFilters";
import type { ActivityCategory, AgentInfo, SessionInfo } from "../dashboard/src/lib/types";

function session(overrides: Partial<SessionInfo>): SessionInfo {
  const breakdown: Record<ActivityCategory, number> = {
    exploring: 0,
    changes: 0,
    git: 0,
    scripts: 0,
    web: 0,
    comms: 0,
    orchestration: 0,
    media: 0,
  };
  return {
    sessionKey: "k",
    agentId: "alpha",
    startTime: "2026-04-26T17:00:00.000Z",
    endTime: "2026-04-26T17:05:00.000Z",
    duration: 5 * 60_000,
    toolCallCount: 3,
    avgRisk: 30,
    peakRisk: 50,
    activityBreakdown: breakdown,
    blockedCount: 0,
    toolSummary: [],
    riskSparkline: [10, 30, 50],
    ...overrides,
  };
}

function agent(id: string): AgentInfo {
  // biome-ignore lint/suspicious/noExplicitAny: minimal AgentInfo for the rail test
  return { id, name: id } as any;
}

const ALPHA = agent("alpha");
const BETA = agent("beta");

const COUNT_BASIS: SessionInfo[] = [
  // 3 alpha sessions: 1 critical, 2 lows
  session({ sessionKey: "a1", agentId: "alpha", avgRisk: 90 }), // crit
  session({ sessionKey: "a2", agentId: "alpha", avgRisk: 5 }), // low
  session({ sessionKey: "a3", agentId: "alpha", avgRisk: 5 }), // low
  // 2 beta sessions: 1 high, 1 medium
  session({ sessionKey: "b1", agentId: "beta", avgRisk: 70 }), // high
  session({ sessionKey: "b2", agentId: "beta", avgRisk: 40 }), // medium
];

function setup(filters: SessionFilters = {}) {
  const onSelect = vi.fn();
  const onClear = vi.fn();
  render(
    <SessionsFilterRail
      filters={filters}
      agents={[ALPHA, BETA]}
      countBasis={COUNT_BASIS}
      onSelect={onSelect}
      onClear={onClear}
    />,
  );
  return { onSelect, onClear };
}

describe("SessionsFilterRail — count badges", () => {
  it("renders the count of matching sessions on each agent option", () => {
    setup();
    expect(screen.getByTestId("filter-row-agent-alpha").textContent).toContain("3");
    expect(screen.getByTestId("filter-row-agent-beta").textContent).toContain("2");
  });

  it("counts respect other active filters (risk=high → only beta has 1 hit)", () => {
    setup({ risk: "high" });
    expect(screen.getByTestId("filter-row-agent-alpha").textContent).toContain("0");
    expect(screen.getByTestId("filter-row-agent-beta").textContent).toContain("1");
  });

  it("renders counts on each risk option", () => {
    setup();
    expect(screen.getByTestId("filter-row-risk-critical").textContent).toContain("1");
    expect(screen.getByTestId("filter-row-risk-high").textContent).toContain("1");
    expect(screen.getByTestId("filter-row-risk-medium").textContent).toContain("1");
    expect(screen.getByTestId("filter-row-risk-low").textContent).toContain("2");
  });
});

describe("SessionsFilterRail — disabled state", () => {
  it("zero-count rows are disabled when not active", () => {
    setup({ risk: "high" }); // alpha gets 0 under risk=high
    const alphaBtn = screen.getByTestId("filter-row-agent-alpha") as HTMLButtonElement;
    expect(alphaBtn).toBeDisabled();
  });

  it("active row stays clickable even at count 0", () => {
    setup({ agent: "alpha", risk: "high" }); // alpha is active AND has count 0
    const alphaBtn = screen.getByTestId("filter-row-agent-alpha") as HTMLButtonElement;
    expect(alphaBtn).not.toBeDisabled();
  });

  it("active row at count 0 still fires onSelect when clicked (so operator can clear)", () => {
    const { onSelect } = setup({ agent: "alpha", risk: "high" });
    fireEvent.click(screen.getByTestId("filter-row-agent-alpha"));
    expect(onSelect).toHaveBeenCalledWith("agent", "alpha");
  });
});
