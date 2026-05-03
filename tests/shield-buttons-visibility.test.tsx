// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import ActivityEntry from "../dashboard/src/components/ActivityEntry";
import RiskPanel from "../dashboard/src/components/RiskPanel";
import type { EntryResponse } from "../dashboard/src/lib/types";

function LocationProbe() {
  const loc = useLocation();
  return (
    <span data-testid="probe-location">
      {loc.pathname}
      {loc.search}
    </span>
  );
}

// jsdom doesn't ship ResizeObserver — RiskPanel's spark-width effect uses it.
class ResizeObserverShim {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverShim);

const baseEntry: EntryResponse = {
  timestamp: new Date().toISOString(),
  toolName: "exec",
  toolCallId: "tc_shield",
  params: { command: "ls" },
  effectiveDecision: "allow",
  category: "scripts",
  agentId: "alpha",
  sessionKey: "sk_1",
  riskScore: 60,
  riskTier: "high",
};

describe("ActivityEntry shield button (§13.3)", () => {
  it("has opacity-40 at rest (visible without hover) — not opacity-0", () => {
    render(
      <MemoryRouter>
        <ActivityEntry entry={baseEntry} description="Run command" />
      </MemoryRouter>,
    );
    const shield = screen.getByTitle("Add guardrail");
    expect(shield.className).toContain("opacity-40");
    expect(shield.className).not.toMatch(/(^|\s)opacity-0(\s|$)/);
  });

  it("retains progressive-reveal hover classes", () => {
    render(
      <MemoryRouter>
        <ActivityEntry entry={baseEntry} description="Run command" />
      </MemoryRouter>,
    );
    const shield = screen.getByTitle("Add guardrail");
    expect(shield.className).toContain("group-hover:opacity-60");
    expect(shield.className).toContain("hover:!opacity-100");
  });
});

describe("RiskPanel shield button (§13.3)", () => {
  it("has opacity-40 at rest — not opacity-0", () => {
    render(
      <MemoryRouter>
        <RiskPanel riskTrend={[]} topRisks={[{ entry: baseEntry, count: 1 }]} />
      </MemoryRouter>,
    );
    const shield = screen.getByTitle("Add guardrail");
    expect(shield.className).toContain("opacity-40");
    expect(shield.className).not.toMatch(/(^|\s)opacity-0(\s|$)/);
  });

  it("retains progressive-reveal hover classes", () => {
    render(
      <MemoryRouter>
        <RiskPanel riskTrend={[]} topRisks={[{ entry: baseEntry, count: 1 }]} />
      </MemoryRouter>,
    );
    const shield = screen.getByTitle("Add guardrail");
    expect(shield.className).toContain("group-hover:opacity-60");
    expect(shield.className).toContain("hover:!opacity-100");
  });
});

/**
 * #52 part 1 — smart shield. When entry.guardrailMatch is present, the
 * shield button navigates to /guardrails?selected=<id> instead of opening
 * the Add-Guardrail modal. Tooltip flips to "See guardrail (<action>)".
 */
const matchedEntry: EntryResponse = {
  ...baseEntry,
  toolCallId: "tc_matched",
  guardrailMatch: { id: "g_existing_42", action: "block" },
};

describe("ActivityEntry shield button — smart behavior (#52)", () => {
  function renderWithRoutes(entry: EntryResponse) {
    return render(
      <MemoryRouter initialEntries={["/activity"]}>
        <LocationProbe />
        <Routes>
          <Route
            path="/activity"
            element={<ActivityEntry entry={entry} description="Run command" />}
          />
          <Route path="/guardrails" element={<div data-testid="guardrails-page">guardrails</div>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("tooltip reads 'See guardrail (block)' when entry.guardrailMatch is set", () => {
    renderWithRoutes(matchedEntry);
    expect(screen.getByTitle("See guardrail (block)")).toBeInTheDocument();
    expect(screen.queryByTitle("Add guardrail")).toBeNull();
  });

  it("clicking the shield navigates to /guardrails?selected=<rule id>", () => {
    renderWithRoutes(matchedEntry);
    fireEvent.click(screen.getByTitle("See guardrail (block)"));
    const probe = screen.getByTestId("probe-location");
    expect(probe.textContent).toContain(
      `/guardrails?selected=${encodeURIComponent("g_existing_42")}`,
    );
  });

  it("preserves the original add-guardrail tooltip when no match exists", () => {
    renderWithRoutes(baseEntry);
    expect(screen.getByTitle("Add guardrail")).toBeInTheDocument();
    expect(screen.queryByTitle(/See guardrail/)).toBeNull();
  });
});

describe("RiskPanel shield button — smart behavior (#52)", () => {
  function renderWithRoutes(entry: EntryResponse) {
    return render(
      <MemoryRouter initialEntries={["/activity"]}>
        <LocationProbe />
        <Routes>
          <Route
            path="/activity"
            element={<RiskPanel riskTrend={[]} topRisks={[{ entry, count: 1 }]} />}
          />
          <Route path="/guardrails" element={<div data-testid="guardrails-page">guardrails</div>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("tooltip reflects guardrail action when match exists", () => {
    renderWithRoutes({
      ...matchedEntry,
      guardrailMatch: { id: "g_panel", action: "require_approval" },
    });
    expect(screen.getByTitle("See guardrail (require_approval)")).toBeInTheDocument();
  });

  it("clicking navigates to /guardrails?selected=<rule id>", () => {
    renderWithRoutes({ ...matchedEntry, guardrailMatch: { id: "g_panel", action: "block" } });
    fireEvent.click(screen.getByTitle("See guardrail (block)"));
    const probe = screen.getByTestId("probe-location");
    expect(probe.textContent).toContain(`/guardrails?selected=${encodeURIComponent("g_panel")}`);
  });

  it("falls back to add-guardrail behavior when no match exists", () => {
    renderWithRoutes(baseEntry);
    expect(screen.getByTitle("Add guardrail")).toBeInTheDocument();
    expect(screen.queryByTitle(/See guardrail/)).toBeNull();
  });
});
