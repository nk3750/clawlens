import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditEntry } from "../src/audit/logger";
import { getFleetActivity } from "../src/dashboard/api";

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    timestamp: new Date().toISOString(),
    toolName: "read",
    params: {},
    prevHash: "0",
    hash: "h",
    ...overrides,
  };
}

describe("getFleetActivity", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Fixed local-time now: 2026-04-20 12:00:00 (local). Tests run in the
    // machine's local tz so build `Date` the same way.
    vi.setSystemTime(new Date(2026, 3, 20, 12, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns every in-range decision entry, ascending by timestamp", () => {
    const now = Date.now();
    const entries = [
      entry({
        timestamp: new Date(now - 60 * 60_000).toISOString(),
        decision: "allow",
        toolCallId: "a",
      }),
      entry({
        timestamp: new Date(now - 30 * 60_000).toISOString(),
        decision: "allow",
        toolCallId: "b",
      }),
      entry({
        timestamp: new Date(now - 10 * 60_000).toISOString(),
        decision: "allow",
        toolCallId: "c",
      }),
    ];
    const res = getFleetActivity(entries, "12h");
    expect(res.entries.map((e) => e.toolCallId)).toEqual(["a", "b", "c"]);
    expect(res.totalActions).toBe(3);
    expect(res.truncated).toBe(false);
  });

  it("excludes non-decision entries (pure execution results with no decision field)", () => {
    const now = Date.now();
    const entries = [
      entry({
        timestamp: new Date(now - 30 * 60_000).toISOString(),
        decision: "allow",
        toolCallId: "decide",
      }),
      entry({
        timestamp: new Date(now - 25 * 60_000).toISOString(),
        executionResult: "success",
        refToolCallId: "decide",
        toolCallId: "result",
      }),
    ];
    const res = getFleetActivity(entries, "12h");
    expect(res.entries.map((e) => e.toolCallId)).toEqual(["decide"]);
  });

  it("respects a rolling range window — drops entries older than now - rangeMs", () => {
    const now = Date.now();
    const entries = [
      entry({
        timestamp: new Date(now - 4 * 60 * 60_000).toISOString(),
        decision: "allow",
        toolCallId: "old",
      }),
      entry({
        timestamp: new Date(now - 30 * 60_000).toISOString(),
        decision: "allow",
        toolCallId: "recent",
      }),
    ];
    const res = getFleetActivity(entries, "1h");
    expect(res.entries.map((e) => e.toolCallId)).toEqual(["recent"]);
  });

  it("returns window startTime/endTime as ISO strings matching the rolling window", () => {
    const now = Date.now();
    const entries = [
      entry({
        timestamp: new Date(now - 30 * 60_000).toISOString(),
        decision: "allow",
      }),
    ];
    const res = getFleetActivity(entries, "3h");
    const endMs = Date.parse(res.endTime);
    const startMs = Date.parse(res.startTime);
    expect(endMs).toBe(now);
    expect(endMs - startMs).toBe(3 * 60 * 60_000);
  });

  it("uses the full local day when a date is provided, ignoring range", () => {
    const entries = [
      // 2026-04-11 01:00 local — inside the target day
      entry({
        timestamp: new Date(2026, 3, 11, 1, 0, 0).toISOString(),
        decision: "allow",
        toolCallId: "early",
      }),
      // 2026-04-11 23:30 local — inside the target day
      entry({
        timestamp: new Date(2026, 3, 11, 23, 30, 0).toISOString(),
        decision: "allow",
        toolCallId: "late",
      }),
      // 2026-04-12 00:05 local — next day, excluded
      entry({
        timestamp: new Date(2026, 3, 12, 0, 5, 0).toISOString(),
        decision: "allow",
        toolCallId: "nextday",
      }),
    ];
    const res = getFleetActivity(entries, "1h", "2026-04-11");
    expect(res.entries.map((e) => e.toolCallId)).toEqual(["early", "late"]);
  });

  it("caps results at 5000 entries, keeps the newest, and sets truncated: true", () => {
    const now = Date.now();
    const entries = Array.from({ length: 5010 }, (_, i) =>
      entry({
        // Spread across 10 minutes so they all fall in a 12h window.
        timestamp: new Date(now - 10 * 60_000 + i).toISOString(),
        decision: "allow",
        toolCallId: `t${i}`,
      }),
    );
    const res = getFleetActivity(entries, "12h");
    expect(res.entries).toHaveLength(5000);
    expect(res.truncated).toBe(true);
    expect(res.totalActions).toBe(5000);
    // First kept entry should be t10 (i=0..9 dropped).
    expect(res.entries[0].toolCallId).toBe("t10");
    expect(res.entries[res.entries.length - 1].toolCallId).toBe("t5009");
  });

  it("applies split-session index so entries get #N sub-session keys", () => {
    // Two runs of the same sessionKey separated by > 30 min → #2 suffix.
    const now = Date.now();
    const sessionKey = "agent:a1:cron:job";
    const entries = [
      entry({
        timestamp: new Date(now - 60 * 60_000).toISOString(),
        decision: "allow",
        toolCallId: "r1-a",
        sessionKey,
      }),
      entry({
        timestamp: new Date(now - 55 * 60_000).toISOString(),
        decision: "allow",
        toolCallId: "r1-b",
        sessionKey,
      }),
      // Gap of 35 min — forces a new sub-session.
      entry({
        timestamp: new Date(now - 20 * 60_000).toISOString(),
        decision: "allow",
        toolCallId: "r2-a",
        sessionKey,
      }),
    ];
    const res = getFleetActivity(entries, "3h");
    const byId = new Map(res.entries.map((e) => [e.toolCallId, e]));
    expect(byId.get("r1-a")?.sessionKey).toBe(sessionKey);
    expect(byId.get("r2-a")?.sessionKey).toBe(`${sessionKey}#2`);
  });

  it("defaults to 12h when range is undefined", () => {
    const now = Date.now();
    const entries = [
      entry({
        timestamp: new Date(now - 11 * 60 * 60_000).toISOString(),
        decision: "allow",
        toolCallId: "inside12h",
      }),
      entry({
        timestamp: new Date(now - 13 * 60 * 60_000).toISOString(),
        decision: "allow",
        toolCallId: "outside12h",
      }),
    ];
    const res = getFleetActivity(entries);
    expect(res.entries.map((e) => e.toolCallId)).toEqual(["inside12h"]);
  });

  it("returns empty entries + truncated=false when no decisions land in the window", () => {
    const entries = [
      entry({
        timestamp: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
        decision: "allow",
      }),
    ];
    const res = getFleetActivity(entries, "1h");
    expect(res.entries).toEqual([]);
    expect(res.totalActions).toBe(0);
    expect(res.truncated).toBe(false);
  });

  it("supports 48h rolling windows", () => {
    const now = Date.now();
    const entries = [
      entry({
        timestamp: new Date(now - 47 * 60 * 60_000).toISOString(),
        decision: "allow",
        toolCallId: "inside48h",
      }),
      entry({
        timestamp: new Date(now - 49 * 60 * 60_000).toISOString(),
        decision: "allow",
        toolCallId: "outside48h",
      }),
    ];
    const res = getFleetActivity(entries, "48h");
    expect(res.entries.map((e) => e.toolCallId)).toEqual(["inside48h"]);
  });

  it("supports 7d rolling windows", () => {
    const now = Date.now();
    const entries = [
      entry({
        timestamp: new Date(now - 6 * 24 * 60 * 60_000).toISOString(),
        decision: "allow",
        toolCallId: "inside7d",
      }),
      entry({
        timestamp: new Date(now - 8 * 24 * 60 * 60_000).toISOString(),
        decision: "allow",
        toolCallId: "outside7d",
      }),
    ];
    const res = getFleetActivity(entries, "7d");
    expect(res.entries.map((e) => e.toolCallId)).toEqual(["inside7d"]);
  });
});
