import { describe, expect, it } from "vitest";
import type { AuditEntry } from "../src/audit/logger";
import { getActivityTimeline } from "../src/dashboard/api";

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    timestamp: new Date().toISOString(),
    toolName: "exec",
    params: { command: "ls" },
    decision: "allow",
    riskScore: 20,
    riskTier: "low",
    agentId: "agent-1",
    prevHash: "0",
    hash: "abc",
    ...overrides,
  };
}

describe("getActivityTimeline", () => {
  it("returns empty response for no entries", () => {
    const result = getActivityTimeline([], 15);
    expect(result.agents).toEqual([]);
    expect(result.buckets).toEqual([]);
    expect(result.totalActions).toBe(0);
    expect(result.startTime).toBe("");
    expect(result.endTime).toBe("");
  });

  it("returns empty response when no decision entries exist", () => {
    const entries = [entry({ decision: undefined, executionResult: "success" })];
    const result = getActivityTimeline(entries, 15);
    expect(result.totalActions).toBe(0);
    expect(result.agents).toEqual([]);
  });

  it("buckets a single agent into a single bucket", () => {
    const now = new Date();
    const entries = [
      entry({ timestamp: now.toISOString(), agentId: "a1", toolName: "exec" }),
      entry({
        timestamp: new Date(now.getTime() + 60_000).toISOString(),
        agentId: "a1",
        toolName: "read",
      }),
    ];
    const result = getActivityTimeline(entries, 15);

    expect(result.agents).toEqual(["a1"]);
    expect(result.totalActions).toBe(2);
    expect(result.buckets).toHaveLength(1);
    expect(result.buckets[0].agentId).toBe("a1");
    expect(result.buckets[0].total).toBe(2);
    expect(result.buckets[0].counts.commands).toBe(1); // exec
    expect(result.buckets[0].counts.exploring).toBe(1); // read
  });

  it("separates entries into different buckets by time", () => {
    const base = new Date("2026-04-11T10:00:00Z").getTime();
    const entries = [
      entry({ timestamp: new Date(base).toISOString(), agentId: "a1" }),
      entry({
        timestamp: new Date(base + 20 * 60_000).toISOString(), // 20 min later → different 15-min bucket
        agentId: "a1",
      }),
    ];
    const result = getActivityTimeline(entries, 15, "2026-04-11");

    expect(result.buckets).toHaveLength(2);
    expect(result.buckets[0].total).toBe(1);
    expect(result.buckets[1].total).toBe(1);
  });

  it("handles multiple agents and sorts by total activity desc", () => {
    const ts = new Date().toISOString();
    const entries = [
      entry({ timestamp: ts, agentId: "busy", toolName: "exec" }),
      entry({ timestamp: ts, agentId: "busy", toolName: "read" }),
      entry({ timestamp: ts, agentId: "busy", toolName: "write" }),
      entry({ timestamp: ts, agentId: "quiet", toolName: "exec" }),
    ];
    const result = getActivityTimeline(entries, 60);

    expect(result.agents).toEqual(["busy", "quiet"]);
    expect(result.totalActions).toBe(4);
  });

  it("tracks peakRisk per bucket", () => {
    const ts = new Date().toISOString();
    const entries = [
      entry({ timestamp: ts, agentId: "a1", riskScore: 20 }),
      entry({ timestamp: ts, agentId: "a1", riskScore: 75 }),
      entry({ timestamp: ts, agentId: "a1", riskScore: 40 }),
    ];
    const result = getActivityTimeline(entries, 60);

    expect(result.buckets[0].peakRisk).toBe(75);
  });

  it("filters by date string", () => {
    const entries = [
      entry({ timestamp: "2026-04-10T10:00:00Z", agentId: "a1" }),
      entry({ timestamp: "2026-04-11T10:00:00Z", agentId: "a1" }),
      entry({ timestamp: "2026-04-11T14:00:00Z", agentId: "a1" }),
    ];
    const result = getActivityTimeline(entries, 15, "2026-04-11");

    expect(result.totalActions).toBe(2);
  });

  it("counts per-category correctly", () => {
    const ts = new Date().toISOString();
    const entries = [
      entry({ timestamp: ts, agentId: "a1", toolName: "exec" }),
      entry({ timestamp: ts, agentId: "a1", toolName: "exec" }),
      entry({ timestamp: ts, agentId: "a1", toolName: "web_fetch" }),
      entry({ timestamp: ts, agentId: "a1", toolName: "read" }),
      entry({ timestamp: ts, agentId: "a1", toolName: "message" }),
    ];
    const result = getActivityTimeline(entries, 60);
    const bucket = result.buckets[0];

    expect(bucket.counts.commands).toBe(2);
    expect(bucket.counts.web).toBe(1);
    expect(bucket.counts.exploring).toBe(1);
    expect(bucket.counts.comms).toBe(1);
    expect(bucket.counts.changes).toBe(0);
    expect(bucket.counts.data).toBe(0);
    expect(bucket.total).toBe(5);
  });

  it("startTime and endTime span the bucket range", () => {
    const base = new Date("2026-04-11T08:00:00Z").getTime();
    const entries = [
      entry({ timestamp: new Date(base).toISOString(), agentId: "a1" }),
      entry({
        timestamp: new Date(base + 3 * 3_600_000).toISOString(), // 3 hours later
        agentId: "a1",
      }),
    ];
    const result = getActivityTimeline(entries, 15, "2026-04-11");

    const startMs = new Date(result.startTime).getTime();
    const endMs = new Date(result.endTime).getTime();
    expect(startMs).toBeLessThanOrEqual(base);
    expect(endMs).toBeGreaterThan(base + 3 * 3_600_000);
  });

  it("assigns unknown agentId when missing", () => {
    const ts = new Date().toISOString();
    const entries = [entry({ timestamp: ts, agentId: undefined })];
    const result = getActivityTimeline(entries, 15);

    expect(result.agents).toEqual(["unknown"]);
    expect(result.buckets[0].agentId).toBe("unknown");
  });
});
