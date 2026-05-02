// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import SessionRow from "../dashboard/src/components/sessions/SessionRow";
import type { ActivityCategory, SessionInfo } from "../dashboard/src/lib/types";

function session(overrides: Partial<SessionInfo> = {}): SessionInfo {
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
    sessionKey: "alpha:terminal:42",
    agentId: "alpha",
    startTime: "2026-04-26T17:00:00.000Z",
    endTime: "2026-04-26T17:05:00.000Z",
    duration: 5 * 60_000,
    toolCallCount: 12,
    avgRisk: 30,
    peakRisk: 50,
    activityBreakdown: breakdown,
    blockedCount: 0,
    context: "terminal",
    toolSummary: [],
    riskSparkline: [10, 20, 30, 40, 50],
    ...overrides,
  };
}

function renderWithRouter(node: React.ReactNode) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

describe("SessionRow — anatomy", () => {
  it("renders the start time, agent, action count, and avg risk", () => {
    renderWithRouter(<SessionRow session={session()} />);
    expect(screen.getByTestId("session-row-time")).toBeInTheDocument();
    expect(screen.getByTestId("session-row-agent")).toHaveTextContent("alpha");
    expect(screen.getByTestId("session-row-meta")).toHaveTextContent(/12/);
    expect(screen.getByTestId("session-row-meta")).toHaveTextContent(/avg/i);
  });

  it("wraps the row in a link to /session/<encoded key>", () => {
    renderWithRouter(<SessionRow session={session({ sessionKey: "alpha:terminal:42" })} />);
    const link = screen.getByTestId("session-row-link") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/session/alpha%3Aterminal%3A42");
  });
});

describe("SessionRow — peak warning glyph", () => {
  it("shows the warning glyph when peakRisk ≥ 60", () => {
    renderWithRouter(<SessionRow session={session({ peakRisk: 60 })} />);
    expect(screen.getByTestId("session-row-peak-warn")).toBeInTheDocument();
  });

  it("hides the warning glyph when peakRisk < 60", () => {
    renderWithRouter(<SessionRow session={session({ peakRisk: 59 })} />);
    expect(screen.queryByTestId("session-row-peak-warn")).toBeNull();
  });
});

describe("SessionRow — LIVE treatment", () => {
  it("renders LIVE in the meta column when endTime is null", () => {
    renderWithRouter(<SessionRow session={session({ endTime: null, duration: null })} />);
    expect(screen.getByTestId("session-row-meta")).toHaveTextContent(/LIVE/);
    expect(screen.getByTestId("session-row-live-dot")).toBeInTheDocument();
  });

  it("does NOT render the LIVE dot when endTime is a real timestamp", () => {
    renderWithRouter(<SessionRow session={session()} />);
    expect(screen.queryByTestId("session-row-live-dot")).toBeNull();
  });
});

describe("SessionRow — RiskTierStrip", () => {
  it("renders one rect per score when sparkline length ≤ 80", () => {
    const { container } = renderWithRouter(
      <SessionRow
        session={session({
          riskSparkline: [10, 20, 30, 40, 50, 60, 70, 80, 90],
        })}
      />,
    );
    const rects = container.querySelectorAll("[data-testid='risk-tier-strip'] rect");
    expect(rects).toHaveLength(9);
  });

  it("buckets to exactly 80 ticks when sparkline length > 80", () => {
    const long = Array.from({ length: 200 }, (_, i) => (i % 100) as number);
    const { container } = renderWithRouter(
      <SessionRow session={session({ riskSparkline: long })} />,
    );
    const rects = container.querySelectorAll("[data-testid='risk-tier-strip'] rect");
    expect(rects).toHaveLength(80);
  });

  it("renders a placeholder svg with zero rects when sparkline is empty", () => {
    const { container } = renderWithRouter(<SessionRow session={session({ riskSparkline: [] })} />);
    const strip = container.querySelector("[data-testid='risk-tier-strip']");
    expect(strip).toBeInTheDocument();
    expect(strip!.querySelectorAll("rect")).toHaveLength(0);
  });

  it("uses opacity 0.25 for score=0 ticks (faint, but visible)", () => {
    const { container } = renderWithRouter(
      <SessionRow session={session({ riskSparkline: [0, 50] })} />,
    );
    const rects = container.querySelectorAll("[data-testid='risk-tier-strip'] rect");
    expect(rects).toHaveLength(2);
    expect((rects[0] as SVGRectElement).getAttribute("opacity")).toBe("0.25");
    expect((rects[1] as SVGRectElement).getAttribute("opacity")).toBe("1");
  });
});
