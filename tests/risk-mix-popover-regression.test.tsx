// @vitest-environment jsdom

// Regression-lock for #29 — the wrapping <Link to="/agent/:id"> click race.
//
// The existing tests/risk-mix-popover.test.tsx mocks `useNavigate` so they
// never exercise React Router's real <Link> click handler. That mock hid the
// bug where the popover button only called e.stopPropagation() — the React
// synthetic event still carried defaultPrevented=false, so when the click
// bubbled past the SPA layer the browser's native anchor follow took over and
// navigated to /agent/<id> instead of /activity?agent=<id>&tier=<worst>.
//
// This file uses real react-router-dom (no mocks) and a wrapping <Link> so
// the regression surface is exercised end-to-end. The single load-bearing
// assertion is `event.defaultPrevented === true`. The follow-up location
// assertion confirms the SPA navigation lands at /activity, not /agent/test.

import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";
import RiskMixPopover from "../dashboard/src/components/RiskMixPopover";
import type { RiskTier } from "../dashboard/src/lib/types";

function mix(partial: Partial<Record<RiskTier, number>>): Record<RiskTier, number> {
  return { low: 0, medium: 0, high: 0, critical: 0, ...partial };
}

function LocationProbe() {
  const loc = useLocation();
  return (
    <span data-testid="loc">
      {loc.pathname}
      {loc.search}
    </span>
  );
}

function renderInsideLink(agentId: string, m: Record<RiskTier, number>) {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <LocationProbe />
      <Routes>
        <Route
          path="/"
          element={
            <Link to={`/agent/${agentId}`} data-testid="parent-link">
              <RiskMixPopover mix={m} agentId={agentId} />
            </Link>
          }
        />
        <Route path="/activity" element={<span data-testid="on-activity">activity</span>} />
        <Route path="/agent/:id" element={<span data-testid="on-agent">agent</span>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("RiskMixPopover — #29 click-bubble regression", () => {
  it("calls preventDefault on the click so the parent <Link>'s native anchor-follow does not fire", () => {
    const { container } = renderInsideLink("test", mix({ critical: 1, low: 5 }));
    const button = container.querySelector<HTMLButtonElement>("button[data-cl-risk-mix-pop-link]");
    expect(button).not.toBeNull();
    const event = createEvent.click(button!);
    fireEvent(button!, event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("after click, location is /activity?agent=<id>&tier=<worst>, NOT /agent/<id>", () => {
    const { container } = renderInsideLink("test", mix({ critical: 1, low: 5 }));
    const button = container.querySelector<HTMLButtonElement>("button[data-cl-risk-mix-pop-link]");
    fireEvent.click(button!);
    expect(screen.getByTestId("loc").textContent).toBe("/activity?agent=test&tier=critical");
    expect(screen.queryByTestId("on-agent")).toBeNull();
    expect(screen.getByTestId("on-activity")).toBeInTheDocument();
  });

  it("works with worst=high when no critical entries are present", () => {
    const { container } = renderInsideLink("seo-growth", mix({ low: 10, medium: 5, high: 1 }));
    const button = container.querySelector<HTMLButtonElement>("button[data-cl-risk-mix-pop-link]");
    fireEvent.click(button!);
    expect(screen.getByTestId("loc").textContent).toBe("/activity?agent=seo-growth&tier=high");
  });
});
