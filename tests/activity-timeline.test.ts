import { describe, expect, it, vi } from "vitest";
import type { AuditEntry } from "../src/audit/logger";
import { DEFAULT_AGENT_ID, getActivityTimeline } from "../src/dashboard/api";

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
    expect(result.bucketMinutes).toBe(15);
  });

  it("returns empty response when no decision entries exist", () => {
    const entries = [entry({ decision: undefined, executionResult: "success" })];
    const result = getActivityTimeline(entries, 15);
    expect(result.totalActions).toBe(0);
    expect(result.agents).toEqual([]);
  });

  it("buckets a single agent into a single bucket", () => {
    // Pin time to middle of a 15-min bucket to avoid boundary flakiness
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-11T10:05:00Z"));
    try {
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
    } finally {
      vi.useRealTimers();
    }
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

  it("assigns DEFAULT_AGENT_ID when agentId is missing", () => {
    const ts = new Date().toISOString();
    const entries = [entry({ timestamp: ts, agentId: undefined })];
    const result = getActivityTimeline(entries, 15);

    expect(result.agents).toEqual([DEFAULT_AGENT_ID]);
    expect(result.buckets[0].agentId).toBe(DEFAULT_AGENT_ID);
  });

  // ── New: sessions tracking ──────────────────────────────

  it("tracks sessions per bucket sorted by count desc", () => {
    const ts = new Date().toISOString();
    const entries = [
      entry({ timestamp: ts, agentId: "a1", sessionKey: "s1", toolCallId: "tc1" }),
      entry({ timestamp: ts, agentId: "a1", sessionKey: "s1", toolCallId: "tc2" }),
      entry({ timestamp: ts, agentId: "a1", sessionKey: "s1", toolCallId: "tc3" }),
      entry({ timestamp: ts, agentId: "a1", sessionKey: "s2", toolCallId: "tc4" }),
    ];
    const result = getActivityTimeline(entries, 60);
    const bucket = result.buckets[0];

    expect(bucket.sessions).toHaveLength(2);
    expect(bucket.sessions[0]).toEqual({ key: "s1", count: 3 });
    expect(bucket.sessions[1]).toEqual({ key: "s2", count: 1 });
  });

  it("assigns unknown sessionKey when missing", () => {
    const ts = new Date().toISOString();
    const entries = [entry({ timestamp: ts, agentId: "a1", sessionKey: undefined })];
    const result = getActivityTimeline(entries, 60);

    expect(result.buckets[0].sessions).toEqual([{ key: "unknown", count: 1 }]);
  });

  it("uses split session keys for cron sessions with 30+ min gaps", () => {
    // Same sessionKey, but entries > 30 min apart → should split into #N sub-sessions
    const base = new Date("2026-04-11T10:00:00Z").getTime();
    const entries = [
      entry({
        timestamp: new Date(base).toISOString(),
        agentId: "a1",
        sessionKey: "agent:bot:cron:job",
        toolCallId: "tc1",
      }),
      entry({
        timestamp: new Date(base + 5 * 60_000).toISOString(), // 5 min later, same run
        agentId: "a1",
        sessionKey: "agent:bot:cron:job",
        toolCallId: "tc2",
      }),
      entry({
        timestamp: new Date(base + 45 * 60_000).toISOString(), // 45 min later → new run
        agentId: "a1",
        sessionKey: "agent:bot:cron:job",
        toolCallId: "tc3",
      }),
    ];
    const result = getActivityTimeline(entries, 60, "2026-04-11");
    const bucket = result.buckets[0];

    // Should have 2 sessions: original key (run 1) and #2 (run 2)
    expect(bucket.sessions).toHaveLength(2);
    const keys = bucket.sessions.map((s) => s.key);
    expect(keys).toContain("agent:bot:cron:job");
    expect(keys).toContain("agent:bot:cron:job#2");
    // First run has 2 entries, second run has 1
    const run1 = bucket.sessions.find((s) => s.key === "agent:bot:cron:job");
    const run2 = bucket.sessions.find((s) => s.key === "agent:bot:cron:job#2");
    expect(run1?.count).toBe(2);
    expect(run2?.count).toBe(1);
  });

  it("split session numbering matches full entry set, not day-filtered subset", () => {
    // Prior-day entries create runs #1 and #2. Today's run should be #3, not #1.
    // This ensures clicking navigates to the correct sub-session.
    const entries = [
      // Day before: two runs of the same cron session
      entry({
        timestamp: "2026-04-10T08:00:00Z",
        agentId: "a1",
        sessionKey: "agent:bot:cron:job",
        toolCallId: "old1",
      }),
      entry({
        timestamp: "2026-04-10T10:00:00Z", // 2h gap → run #2
        agentId: "a1",
        sessionKey: "agent:bot:cron:job",
        toolCallId: "old2",
      }),
      // Today: another run
      entry({
        timestamp: "2026-04-11T08:00:00Z", // >30 min gap → run #3
        agentId: "a1",
        sessionKey: "agent:bot:cron:job",
        toolCallId: "today1",
      }),
    ];
    const result = getActivityTimeline(entries, 60, "2026-04-11");

    expect(result.totalActions).toBe(1);
    expect(result.buckets).toHaveLength(1);
    // Today's entry should be #3 (accounting for prior-day runs), not #1
    expect(result.buckets[0].sessions).toEqual([{ key: "agent:bot:cron:job#3", count: 1 }]);
  });

  // ── New: topTools tracking ──────────────────────────────

  it("tracks topTools limited to top 3 sorted by count desc", () => {
    const ts = new Date().toISOString();
    const entries = [
      entry({ timestamp: ts, agentId: "a1", toolName: "exec" }),
      entry({ timestamp: ts, agentId: "a1", toolName: "exec" }),
      entry({ timestamp: ts, agentId: "a1", toolName: "exec" }),
      entry({ timestamp: ts, agentId: "a1", toolName: "read" }),
      entry({ timestamp: ts, agentId: "a1", toolName: "read" }),
      entry({ timestamp: ts, agentId: "a1", toolName: "web_fetch" }),
      entry({ timestamp: ts, agentId: "a1", toolName: "write" }),
    ];
    const result = getActivityTimeline(entries, 60);
    const bucket = result.buckets[0];

    expect(bucket.topTools).toHaveLength(3);
    expect(bucket.topTools[0]).toEqual({ name: "exec", count: 3 });
    expect(bucket.topTools[1]).toEqual({ name: "read", count: 2 });
    // Third could be web_fetch or write (both have 1), check it's one of them
    expect(bucket.topTools[2].count).toBe(1);
  });

  it("returns fewer than 3 tools when bucket has fewer", () => {
    const ts = new Date().toISOString();
    const entries = [entry({ timestamp: ts, agentId: "a1", toolName: "exec" })];
    const result = getActivityTimeline(entries, 60);

    expect(result.buckets[0].topTools).toEqual([{ name: "exec", count: 1 }]);
  });

  // ── New: tags tracking ──────────────────────────────────

  it("collects unique tags from entries", () => {
    const ts = new Date().toISOString();
    const entries = [
      entry({ timestamp: ts, agentId: "a1", riskTags: ["network-read", "scripting"] }),
      entry({ timestamp: ts, agentId: "a1", riskTags: ["scripting", "destructive"] }),
      entry({ timestamp: ts, agentId: "a1", riskTags: ["network-read"] }),
    ];
    const result = getActivityTimeline(entries, 60);
    const bucket = result.buckets[0];

    expect(bucket.tags).toHaveLength(3);
    expect(bucket.tags.sort()).toEqual(["destructive", "network-read", "scripting"]);
  });

  it("returns empty tags when no riskTags on entries", () => {
    const ts = new Date().toISOString();
    const entries = [entry({ timestamp: ts, agentId: "a1", riskTags: undefined })];
    const result = getActivityTimeline(entries, 60);

    expect(result.buckets[0].tags).toEqual([]);
  });

  // ── New: range filtering ────────────────────────────────

  it("filters entries to the last N hours of a pinned past day", () => {
    const entries = [
      entry({ timestamp: new Date(2026, 3, 11, 1, 0, 0).toISOString(), agentId: "a1" }), // 01:00 — outside
      entry({ timestamp: new Date(2026, 3, 11, 10, 0, 0).toISOString(), agentId: "a1" }), // 10:00 — outside
      entry({ timestamp: new Date(2026, 3, 11, 20, 0, 0).toISOString(), agentId: "a1" }), // 20:00 — outside (before 21:00)
      entry({ timestamp: new Date(2026, 3, 11, 21, 30, 0).toISOString(), agentId: "a1" }), // 21:30 — inside
      entry({ timestamp: new Date(2026, 3, 11, 23, 0, 0).toISOString(), agentId: "a1" }), // 23:00 — inside
    ];
    // 3h range on a pinned day = last 3h (21:00-24:00 local)
    const result = getActivityTimeline(entries, undefined, "2026-04-11", "3h");

    expect(result.totalActions).toBe(2);
    expect(result.bucketMinutes).toBe(5); // auto bucket for 3h
  });

  it("uses auto bucket sizing when bucketMinutes not provided", () => {
    const ts = new Date().toISOString();
    const entries = [entry({ timestamp: ts, agentId: "a1" })];

    expect(getActivityTimeline(entries, undefined, undefined, "1h").bucketMinutes).toBe(5);
    expect(getActivityTimeline(entries, undefined, undefined, "3h").bucketMinutes).toBe(5);
    expect(getActivityTimeline(entries, undefined, undefined, "6h").bucketMinutes).toBe(15);
    expect(getActivityTimeline(entries, undefined, undefined, "12h").bucketMinutes).toBe(15);
    expect(getActivityTimeline(entries, undefined, undefined, "24h").bucketMinutes).toBe(30);
  });

  it("respects explicit bucketMinutes over auto mapping", () => {
    const ts = new Date().toISOString();
    const entries = [entry({ timestamp: ts, agentId: "a1" })];
    const result = getActivityTimeline(entries, 10, undefined, "1h");

    expect(result.bucketMinutes).toBe(10);
  });

  it("defaults to 15-min buckets when no range and no bucketMinutes", () => {
    const ts = new Date().toISOString();
    const entries = [entry({ timestamp: ts, agentId: "a1" })];
    const result = getActivityTimeline(entries);

    expect(result.bucketMinutes).toBe(15);
  });

  it("includes bucketMinutes in response", () => {
    const result = getActivityTimeline([], 30);
    expect(result.bucketMinutes).toBe(30);
  });

  it("filters entries by range for today", () => {
    vi.useFakeTimers();
    try {
      const now = new Date("2026-04-11T12:00:00Z");
      vi.setSystemTime(now);

      const entries = [
        entry({ timestamp: "2026-04-11T08:00:00Z", agentId: "a1" }), // 4h ago — outside 3h
        entry({ timestamp: "2026-04-11T10:00:00Z", agentId: "a1" }), // 2h ago — inside 3h
        entry({ timestamp: "2026-04-11T11:30:00Z", agentId: "a1" }), // 30m ago — inside 3h
      ];
      // no dateStr → today. 3h range = now-3h to now = 09:00 to 12:00
      const result = getActivityTimeline(entries, undefined, undefined, "3h");

      expect(result.totalActions).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns empty when range filters out all entries", () => {
    const entries = [
      entry({ timestamp: new Date(2026, 3, 11, 10, 0, 0).toISOString(), agentId: "a1" }),
    ];
    // 1h range on past day = last hour (23:00-24:00 local), entry at 10:00 local is outside
    const result = getActivityTimeline(entries, undefined, "2026-04-11", "1h");

    expect(result.totalActions).toBe(0);
    expect(result.buckets).toEqual([]);
  });

  it("ignores invalid range format gracefully", () => {
    const ts = new Date().toISOString();
    const entries = [entry({ timestamp: ts, agentId: "a1" })];
    // "invalid" range → no filtering, falls back to 15-min bucket
    const result = getActivityTimeline(entries, undefined, undefined, "invalid");

    expect(result.totalActions).toBe(1);
    expect(result.bucketMinutes).toBe(15);
  });

  // ── Rolling-window range pills (#8): range must span midnight ───────

  it("24h range on today spans midnight and includes yesterday's entries", () => {
    vi.useFakeTimers();
    try {
      // Pin time to 07:30 local — window = [yesterday 07:30, today 07:30]
      vi.setSystemTime(new Date(2026, 3, 11, 7, 30, 0));
      const entries = [
        entry({ timestamp: new Date(2026, 3, 10, 17, 0, 0).toISOString(), agentId: "a1" }), // yesterday 17:00 (~14.5h ago)
        entry({ timestamp: new Date(2026, 3, 10, 22, 0, 0).toISOString(), agentId: "a1" }), // yesterday 22:00 (~9.5h ago)
        entry({ timestamp: new Date(2026, 3, 11, 6, 0, 0).toISOString(), agentId: "a1" }), // today 06:00 (~1.5h ago)
        entry({ timestamp: new Date(2026, 3, 11, 7, 0, 0).toISOString(), agentId: "a1" }), // today 07:00 (~30m ago)
      ];
      const result = getActivityTimeline(entries, undefined, undefined, "24h");

      expect(result.totalActions).toBe(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("12h range on today excludes entries older than 12h across midnight", () => {
    vi.useFakeTimers();
    try {
      // Pin time to 07:30 local — window = [yesterday 19:30, today 07:30]
      vi.setSystemTime(new Date(2026, 3, 11, 7, 30, 0));
      const entries = [
        entry({ timestamp: new Date(2026, 3, 10, 18, 0, 0).toISOString(), agentId: "a1" }), // yesterday 18:00 (~13.5h ago → OUT)
        entry({ timestamp: new Date(2026, 3, 10, 20, 0, 0).toISOString(), agentId: "a1" }), // yesterday 20:00 (~11.5h ago → IN)
        entry({ timestamp: new Date(2026, 3, 11, 5, 0, 0).toISOString(), agentId: "a1" }), // today 05:00 → IN
        entry({ timestamp: new Date(2026, 3, 11, 7, 0, 0).toISOString(), agentId: "a1" }), // today 07:00 → IN
      ];
      const result = getActivityTimeline(entries, undefined, undefined, "12h");

      expect(result.totalActions).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("24h range on pinned past date equals full-day result (sanity: 24h pill is a no-op for a pinned day)", () => {
    const entries = [
      entry({ timestamp: new Date(2026, 3, 11, 2, 0, 0).toISOString(), agentId: "a1" }),
      entry({ timestamp: new Date(2026, 3, 11, 10, 0, 0).toISOString(), agentId: "a1" }),
      entry({ timestamp: new Date(2026, 3, 11, 20, 0, 0).toISOString(), agentId: "a1" }),
    ];
    const fullDay = getActivityTimeline(entries, undefined, "2026-04-11");
    const with24h = getActivityTimeline(entries, undefined, "2026-04-11", "24h");

    expect(with24h.totalActions).toBe(fullDay.totalActions);
    expect(with24h.totalActions).toBe(3);
  });

  it("6h range on pinned past date returns the last 6 hours of that day", () => {
    const entries = [
      entry({ timestamp: new Date(2026, 3, 11, 10, 0, 0).toISOString(), agentId: "a1" }), // 10:00 — outside
      entry({ timestamp: new Date(2026, 3, 11, 17, 30, 0).toISOString(), agentId: "a1" }), // 17:30 — outside (before 18:00)
      entry({ timestamp: new Date(2026, 3, 11, 18, 0, 0).toISOString(), agentId: "a1" }), // 18:00 — inside
      entry({ timestamp: new Date(2026, 3, 11, 22, 0, 0).toISOString(), agentId: "a1" }), // 22:00 — inside
      entry({ timestamp: new Date(2026, 3, 11, 23, 59, 0).toISOString(), agentId: "a1" }), // 23:59 — inside
    ];
    // 6h range on pinned day = last 6h (18:00-24:00 local)
    const result = getActivityTimeline(entries, undefined, "2026-04-11", "6h");

    expect(result.totalActions).toBe(3);
  });
});
