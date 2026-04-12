import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditEntry } from "../src/audit/logger";
import { DEFAULT_AGENT_ID, getActivityTimeline, getAgents } from "../src/dashboard/api";

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

describe("DEFAULT_AGENT_ID", () => {
  it("equals 'default'", () => {
    expect(DEFAULT_AGENT_ID).toBe("default");
  });
});

describe("getAgents sort order", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-11T14:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sorts active agents before idle agents", () => {
    const entries = [
      // Agent A: last activity 2 minutes ago → active
      entry({
        agentId: "agentA",
        timestamp: "2026-04-11T13:58:00Z",
        decision: "allow",
      }),
      // Agent B: last activity 1 hour ago → idle
      entry({
        agentId: "agentB",
        timestamp: "2026-04-11T13:00:00Z",
        decision: "allow",
      }),
    ];
    const agents = getAgents(entries);
    expect(agents[0].id).toBe("agentA");
    expect(agents[0].status).toBe("active");
    expect(agents[1].id).toBe("agentB");
    expect(agents[1].status).toBe("idle");
  });

  it("uses todayToolCalls desc as secondary sort key", () => {
    const entries = [
      // Agent A: idle, 1 action
      entry({
        agentId: "agentA",
        timestamp: "2026-04-11T10:00:00Z",
        decision: "allow",
      }),
      // Agent B: idle, 3 actions
      entry({
        agentId: "agentB",
        timestamp: "2026-04-11T10:00:00Z",
        decision: "allow",
      }),
      entry({
        agentId: "agentB",
        timestamp: "2026-04-11T10:01:00Z",
        decision: "allow",
      }),
      entry({
        agentId: "agentB",
        timestamp: "2026-04-11T10:02:00Z",
        decision: "allow",
      }),
      // Agent C: idle, 2 actions
      entry({
        agentId: "agentC",
        timestamp: "2026-04-11T10:00:00Z",
        decision: "allow",
      }),
      entry({
        agentId: "agentC",
        timestamp: "2026-04-11T10:01:00Z",
        decision: "allow",
      }),
    ];
    const agents = getAgents(entries);
    expect(agents.map((a) => a.id)).toEqual(["agentB", "agentC", "agentA"]);
  });

  it("uses lastActiveTimestamp desc as tertiary sort key", () => {
    // Two idle agents with same todayToolCalls count
    const entries = [
      entry({
        agentId: "agentEarly",
        timestamp: "2026-04-11T10:00:00Z",
        decision: "allow",
      }),
      entry({
        agentId: "agentLate",
        timestamp: "2026-04-11T12:00:00Z",
        decision: "allow",
      }),
    ];
    const agents = getAgents(entries);
    // agentLate has later timestamp, should come first
    expect(agents[0].id).toBe("agentLate");
    expect(agents[1].id).toBe("agentEarly");
  });

  it("sorts needsAttention agents first on frontend sort order", () => {
    // Simulate the frontend sort: needsAttention first, then todayToolCalls desc
    const entries = [
      // Agent A: high activity, no attention
      entry({
        agentId: "agentA",
        timestamp: "2026-04-11T13:50:00Z",
        decision: "allow",
      }),
      entry({
        agentId: "agentA",
        timestamp: "2026-04-11T13:51:00Z",
        decision: "allow",
      }),
      entry({
        agentId: "agentA",
        timestamp: "2026-04-11T13:52:00Z",
        decision: "allow",
      }),
      // Agent B: blocked recently → needsAttention
      entry({
        agentId: "agentB",
        timestamp: "2026-04-11T13:55:00Z",
        decision: "block",
      }),
    ];
    const agents = getAgents(entries);

    // Apply frontend sort (same logic as Agents.tsx)
    const frontendSorted = [...agents].sort((a, b) => {
      if (a.needsAttention !== b.needsAttention) return a.needsAttention ? -1 : 1;
      return b.todayToolCalls - a.todayToolCalls;
    });

    expect(frontendSorted[0].id).toBe("agentB");
    expect(frontendSorted[0].needsAttention).toBe(true);
    expect(frontendSorted[1].id).toBe("agentA");
  });
});

describe("getAgents uses DEFAULT_AGENT_ID for entries without agentId", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-11T14:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("groups entries without agentId under DEFAULT_AGENT_ID", () => {
    const entries = [
      entry({
        timestamp: "2026-04-11T13:00:00Z",
        decision: "allow",
        // No agentId
      }),
      entry({
        agentId: "myAgent",
        timestamp: "2026-04-11T13:00:00Z",
        decision: "allow",
      }),
    ];
    const agents = getAgents(entries);
    const ids = agents.map((a) => a.id);
    expect(ids).toContain(DEFAULT_AGENT_ID);
    expect(ids).toContain("myAgent");
    expect(ids).not.toContain("unknown");
  });
});

describe("getActivityTimeline uses DEFAULT_AGENT_ID", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-11T14:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses DEFAULT_AGENT_ID for entries without agentId", () => {
    const entries = [
      entry({
        timestamp: "2026-04-11T13:00:00Z",
        decision: "allow",
        // No agentId
      }),
    ];
    const timeline = getActivityTimeline(entries);
    // The timeline should contain DEFAULT_AGENT_ID in agents list, not "unknown"
    expect(timeline.agents).toContain(DEFAULT_AGENT_ID);
    expect(timeline.agents).not.toContain("unknown");
  });

  it("uses the actual agentId when present", () => {
    const entries = [
      entry({
        agentId: "myAgent",
        timestamp: "2026-04-11T13:00:00Z",
        decision: "allow",
      }),
    ];
    const timeline = getActivityTimeline(entries);
    expect(timeline.agents).toContain("myAgent");
  });
});
