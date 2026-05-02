// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import ActivityEntry from "../dashboard/src/components/ActivityEntry";
import RiskPanel from "../dashboard/src/components/RiskPanel";
import type { EntryResponse } from "../dashboard/src/lib/types";

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
