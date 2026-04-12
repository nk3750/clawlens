import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditEntry } from "../src/audit/logger";
import { getAgents } from "../src/dashboard/api";

/** Build a minimal AuditEntry with overrides. */
function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    timestamp: new Date().toISOString(),
    toolName: "exec",
    params: {},
    prevHash: "0",
    hash: "abc",
    ...overrides,
  };
}

describe("hourlyActivity computation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-11T14:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("produces 24-element array with correct hour buckets", () => {
    const entries = [
      entry({
        agentId: "agent1",
        timestamp: "2026-04-11T08:15:00Z",
        decision: "allow",
      }),
      entry({
        agentId: "agent1",
        timestamp: "2026-04-11T08:45:00Z",
        decision: "allow",
      }),
      entry({
        agentId: "agent1",
        timestamp: "2026-04-11T12:00:00Z",
        decision: "allow",
      }),
    ];
    const agents = getAgents(entries);
    expect(agents).toHaveLength(1);

    const hourly = agents[0].hourlyActivity;
    expect(hourly).toHaveLength(24);
    expect(hourly[8]).toBe(2); // two entries at hour 8
    expect(hourly[12]).toBe(1); // one entry at hour 12
    // All other hours should be 0
    const sum = hourly.reduce((a, b) => a + b, 0);
    expect(sum).toBe(3);
  });

  it("returns all zeros when agent has no decision entries today", () => {
    // Agent has an old decision (creates the bucket) but no decisions today
    const entries = [
      entry({
        agentId: "agent1",
        timestamp: "2026-04-10T10:00:00Z",
        decision: "allow",
      }),
    ];
    const agents = getAgents(entries);
    expect(agents).toHaveLength(1);
    expect(agents[0].hourlyActivity).toHaveLength(24);
    expect(agents[0].hourlyActivity.every((v) => v === 0)).toBe(true);
  });

  it("does not create an agent from only non-decision entries", () => {
    const entries = [
      entry({
        agentId: "agent1",
        timestamp: "2026-04-11T10:00:00Z",
        executionResult: "success",
      }),
    ];
    const agents = getAgents(entries);
    expect(agents).toHaveLength(0);
  });

  it("computes hourly buckets for past-day view", () => {
    const entries = [
      entry({
        agentId: "agent1",
        timestamp: "2026-04-10T09:30:00Z",
        decision: "allow",
      }),
      entry({
        agentId: "agent1",
        timestamp: "2026-04-10T09:45:00Z",
        decision: "allow",
      }),
      entry({
        agentId: "agent1",
        timestamp: "2026-04-10T15:00:00Z",
        decision: "allow",
      }),
    ];
    const agents = getAgents(entries, "2026-04-10");
    expect(agents).toHaveLength(1);

    const hourly = agents[0].hourlyActivity;
    expect(hourly[9]).toBe(2);
    expect(hourly[15]).toBe(1);
    const sum = hourly.reduce((a, b) => a + b, 0);
    expect(sum).toBe(3);
  });

  it("keeps separate hourly arrays per agent", () => {
    const entries = [
      entry({
        agentId: "agentA",
        timestamp: "2026-04-11T10:00:00Z",
        decision: "allow",
      }),
      entry({
        agentId: "agentB",
        timestamp: "2026-04-11T11:00:00Z",
        decision: "allow",
      }),
    ];
    const agents = getAgents(entries);
    const a = agents.find((x) => x.id === "agentA")!;
    const b = agents.find((x) => x.id === "agentB")!;
    expect(a.hourlyActivity[10]).toBe(1);
    expect(a.hourlyActivity[11]).toBe(0);
    expect(b.hourlyActivity[11]).toBe(1);
    expect(b.hourlyActivity[10]).toBe(0);
  });
});

describe("active vs idle sort", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-11T14:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("agents with todayToolCalls > 0 sort before idle agents", () => {
    const entries = [
      // agentActive: has decisions today
      entry({
        agentId: "agentActive",
        timestamp: "2026-04-11T10:00:00Z",
        decision: "allow",
      }),
      // agentIdle: has an old decision but nothing today
      entry({
        agentId: "agentIdle",
        timestamp: "2026-04-10T10:00:00Z",
        decision: "allow",
      }),
    ];
    const agents = getAgents(entries);

    // Apply frontend sort (same as Agents.tsx)
    const sorted = [...agents].sort((a, b) => {
      if (a.needsAttention !== b.needsAttention) return a.needsAttention ? -1 : 1;
      return b.todayToolCalls - a.todayToolCalls;
    });

    const active = sorted.filter((a) => a.todayToolCalls > 0);
    const idle = sorted.filter((a) => a.todayToolCalls === 0);

    expect(active.length).toBeGreaterThan(0);
    expect(idle.length).toBeGreaterThan(0);
    // All active agents should come before idle
    const lastActiveIdx = sorted.findIndex((a) => a.todayToolCalls === 0);
    for (let i = 0; i < lastActiveIdx; i++) {
      expect(sorted[i].todayToolCalls).toBeGreaterThan(0);
    }
  });
});
