import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditEntry } from "../src/audit/logger";
import { getSessions } from "../src/dashboard/api";

/**
 * Tests for the §4 backend extension to getSessions: SessionFilters shape with
 * agentId / avgRiskTier / durationBucket / since, plus the spec-locked
 * tiebreaker on peakRisk and the active-session pass-through.
 */

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    timestamp: new Date().toISOString(),
    toolName: "exec",
    params: {},
    decision: "allow",
    riskScore: 10,
    prevHash: "0",
    hash: "abc",
    ...overrides,
  };
}

const NOW = new Date("2026-04-26T18:00:00.000Z");

describe("getSessions — backwards-compat with old (agentId) signature", () => {
  it("accepts no second arg (returns all sessions)", () => {
    const entries = [
      entry({ sessionKey: "s1", agentId: "alpha", timestamp: "2026-03-29T10:00:00Z" }),
      entry({ sessionKey: "s2", agentId: "beta", timestamp: "2026-03-29T11:00:00Z" }),
    ];
    const result = getSessions(entries);
    expect(result.total).toBe(2);
  });

  it("accepts a string agentId as the second arg", () => {
    const entries = [
      entry({ sessionKey: "s1", agentId: "alpha", timestamp: "2026-03-29T10:00:00Z" }),
      entry({ sessionKey: "s2", agentId: "beta", timestamp: "2026-03-29T11:00:00Z" }),
    ];
    const result = getSessions(entries, "alpha");
    expect(result.total).toBe(1);
    expect(result.sessions[0].agentId).toBe("alpha");
  });
});

describe("getSessions — SessionFilters: agentId", () => {
  it("filters via { agentId } in the filter object", () => {
    const entries = [
      entry({ sessionKey: "s1", agentId: "alpha", timestamp: "2026-03-29T10:00:00Z" }),
      entry({ sessionKey: "s2", agentId: "beta", timestamp: "2026-03-29T11:00:00Z" }),
    ];
    const result = getSessions(entries, { agentId: "alpha" });
    expect(result.total).toBe(1);
    expect(result.sessions[0].agentId).toBe("alpha");
  });
});

describe("getSessions — SessionFilters: avgRiskTier", () => {
  it("returns only sessions with avgRisk in the high tier", () => {
    const entries = [
      // s_low: avg = 10 → low
      entry({
        sessionKey: "s_low",
        agentId: "alpha",
        timestamp: "2026-03-29T10:00:00Z",
        riskScore: 10,
      }),
      entry({
        sessionKey: "s_low",
        agentId: "alpha",
        timestamp: "2026-03-29T10:01:00Z",
        riskScore: 10,
      }),
      // s_high: avg = 70 → high
      entry({
        sessionKey: "s_high",
        agentId: "beta",
        timestamp: "2026-03-29T10:02:00Z",
        riskScore: 60,
      }),
      entry({
        sessionKey: "s_high",
        agentId: "beta",
        timestamp: "2026-03-29T10:03:00Z",
        riskScore: 80,
      }),
    ];
    const result = getSessions(entries, { avgRiskTier: "high" });
    expect(result.total).toBe(1);
    expect(result.sessions[0].sessionKey).toBe("s_high");
  });

  it("returns only sessions with avgRisk in the critical tier", () => {
    const entries = [
      entry({
        sessionKey: "s_med",
        agentId: "alpha",
        timestamp: "2026-03-29T10:00:00Z",
        riskScore: 30,
      }),
      entry({
        sessionKey: "s_crit",
        agentId: "beta",
        timestamp: "2026-03-29T10:02:00Z",
        riskScore: 90,
      }),
    ];
    const result = getSessions(entries, { avgRiskTier: "critical" });
    expect(result.total).toBe(1);
    expect(result.sessions[0].sessionKey).toBe("s_crit");
  });
});

describe("getSessions — SessionFilters: durationBucket", () => {
  it("lt1m returns only sessions with duration < 60s", () => {
    const entries = [
      // 30s — in lt1m
      entry({ sessionKey: "short", agentId: "a", timestamp: "2026-03-29T10:00:00Z" }),
      entry({ sessionKey: "short", agentId: "a", timestamp: "2026-03-29T10:00:30Z" }),
      // 5min — in 1to10m
      entry({ sessionKey: "mid", agentId: "a", timestamp: "2026-03-29T11:00:00Z" }),
      entry({ sessionKey: "mid", agentId: "a", timestamp: "2026-03-29T11:05:00Z" }),
      // 15min — in gt10m
      entry({ sessionKey: "long", agentId: "a", timestamp: "2026-03-29T12:00:00Z" }),
      entry({ sessionKey: "long", agentId: "a", timestamp: "2026-03-29T12:15:00Z" }),
    ];
    const result = getSessions(entries, { durationBucket: "lt1m" });
    expect(result.total).toBe(1);
    expect(result.sessions[0].sessionKey).toBe("short");
  });

  it("1to10m returns only sessions with 60s ≤ duration < 600s", () => {
    const entries = [
      entry({ sessionKey: "short", agentId: "a", timestamp: "2026-03-29T10:00:00Z" }),
      entry({ sessionKey: "short", agentId: "a", timestamp: "2026-03-29T10:00:30Z" }),
      entry({ sessionKey: "mid", agentId: "a", timestamp: "2026-03-29T11:00:00Z" }),
      entry({ sessionKey: "mid", agentId: "a", timestamp: "2026-03-29T11:05:00Z" }),
      entry({ sessionKey: "long", agentId: "a", timestamp: "2026-03-29T12:00:00Z" }),
      entry({ sessionKey: "long", agentId: "a", timestamp: "2026-03-29T12:15:00Z" }),
    ];
    const result = getSessions(entries, { durationBucket: "1to10m" });
    expect(result.total).toBe(1);
    expect(result.sessions[0].sessionKey).toBe("mid");
  });

  it("gt10m returns only sessions with duration ≥ 600s", () => {
    const entries = [
      entry({ sessionKey: "short", agentId: "a", timestamp: "2026-03-29T10:00:00Z" }),
      entry({ sessionKey: "short", agentId: "a", timestamp: "2026-03-29T10:00:30Z" }),
      entry({ sessionKey: "mid", agentId: "a", timestamp: "2026-03-29T11:00:00Z" }),
      entry({ sessionKey: "mid", agentId: "a", timestamp: "2026-03-29T11:05:00Z" }),
      entry({ sessionKey: "long", agentId: "a", timestamp: "2026-03-29T12:00:00Z" }),
      entry({ sessionKey: "long", agentId: "a", timestamp: "2026-03-29T12:15:00Z" }),
    ];
    const result = getSessions(entries, { durationBucket: "gt10m" });
    expect(result.total).toBe(1);
    expect(result.sessions[0].sessionKey).toBe("long");
  });
});

describe("getSessions — SessionFilters: since", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("since=1h returns only sessions whose startTime is within the last hour", () => {
    // session A: ended 1h45m ago — outside 1h window. Entries 5 min apart so
    // they don't get split by the 30-min session-gap rule.
    const oldStart = new Date(NOW.getTime() - 110 * 60_000).toISOString();
    const oldEnd = new Date(NOW.getTime() - 105 * 60_000).toISOString();
    // session B: started 30m ago, ended 25m ago — inside 1h window. Both >5min
    // before NOW so the active-marking logic leaves endTime intact.
    const thirtyMinAgo = new Date(NOW.getTime() - 30 * 60_000).toISOString();
    const twentyFiveMinAgo = new Date(NOW.getTime() - 25 * 60_000).toISOString();
    const entries = [
      entry({ sessionKey: "old", agentId: "a", timestamp: oldStart }),
      entry({ sessionKey: "old", agentId: "a", timestamp: oldEnd }),
      entry({ sessionKey: "fresh", agentId: "a", timestamp: thirtyMinAgo }),
      entry({ sessionKey: "fresh", agentId: "a", timestamp: twentyFiveMinAgo }),
    ];
    const result = getSessions(entries, { since: "1h" });
    expect(result.total).toBe(1);
    expect(result.sessions[0].sessionKey).toBe("fresh");
  });

  it("active sessions (endTime === null) always pass the since filter", () => {
    // Active session: two entries inside the active window (last 5 min). Even
    // though the "since=1h" cutoff is way after the start, the active path
    // makes it pass.
    const fourMinAgo = new Date(NOW.getTime() - 4 * 60_000).toISOString();
    const oneMinAgo = new Date(NOW.getTime() - 60_000).toISOString();
    // Old closed session: 1h45m ago — outside the 1h window.
    const oldStart = new Date(NOW.getTime() - 110 * 60_000).toISOString();
    const oldEnd = new Date(NOW.getTime() - 105 * 60_000).toISOString();
    const entries = [
      entry({ sessionKey: "live", agentId: "a", timestamp: fourMinAgo }),
      entry({ sessionKey: "live", agentId: "a", timestamp: oneMinAgo }),
      entry({ sessionKey: "old", agentId: "a", timestamp: oldStart }),
      entry({ sessionKey: "old", agentId: "a", timestamp: oldEnd }),
    ];
    const result = getSessions(entries, { since: "1h" });
    expect(result.total).toBe(1);
    expect(result.sessions[0].sessionKey).toBe("live");
    expect(result.sessions[0].endTime).toBeNull();
  });

  it("active session (last entry within 5min of now) has endTime null and duration null", () => {
    const fourMinAgo = new Date(NOW.getTime() - 4 * 60_000).toISOString();
    const oneMinAgo = new Date(NOW.getTime() - 60_000).toISOString();
    const entries = [
      entry({ sessionKey: "live", agentId: "a", timestamp: fourMinAgo }),
      entry({ sessionKey: "live", agentId: "a", timestamp: oneMinAgo }),
    ];
    const result = getSessions(entries, {});
    const live = result.sessions.find((s) => s.sessionKey === "live");
    expect(live).toBeDefined();
    expect(live!.endTime).toBeNull();
    expect(live!.duration).toBeNull();
  });

  it("closed session (last entry older than 5min) keeps its endTime and duration", () => {
    // Two entries 5 min apart, last one 10 min ago: same session (no split),
    // last entry past the active threshold.
    const fifteenMinAgo = new Date(NOW.getTime() - 15 * 60_000).toISOString();
    const tenMinAgo = new Date(NOW.getTime() - 10 * 60_000).toISOString();
    const entries = [
      entry({ sessionKey: "closed", agentId: "a", timestamp: fifteenMinAgo }),
      entry({ sessionKey: "closed", agentId: "a", timestamp: tenMinAgo }),
    ];
    const result = getSessions(entries, {});
    expect(result.sessions[0].endTime).not.toBeNull();
    expect(result.sessions[0].duration).not.toBeNull();
  });
});

describe("getSessions — combined filters", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("intersects agentId + avgRiskTier + since", () => {
    const start = new Date(NOW.getTime() - 30 * 60_000).toISOString();
    const end = new Date(NOW.getTime() - 25 * 60_000).toISOString();
    const oldStart = new Date(NOW.getTime() - 26 * 3600_000).toISOString();
    const oldEnd = new Date(NOW.getTime() - 25 * 3600_000).toISOString();
    const entries = [
      // alpha + critical + within 24h — match
      entry({ sessionKey: "match", agentId: "alpha", timestamp: start, riskScore: 90 }),
      entry({ sessionKey: "match", agentId: "alpha", timestamp: end, riskScore: 90 }),
      // beta — wrong agent
      entry({ sessionKey: "wrong-agent", agentId: "beta", timestamp: start, riskScore: 90 }),
      entry({ sessionKey: "wrong-agent", agentId: "beta", timestamp: end, riskScore: 90 }),
      // alpha + low — wrong tier
      entry({ sessionKey: "wrong-tier", agentId: "alpha", timestamp: start, riskScore: 5 }),
      entry({ sessionKey: "wrong-tier", agentId: "alpha", timestamp: end, riskScore: 5 }),
      // alpha + critical but outside 24h — too old
      entry({ sessionKey: "too-old", agentId: "alpha", timestamp: oldStart, riskScore: 90 }),
      entry({ sessionKey: "too-old", agentId: "alpha", timestamp: oldEnd, riskScore: 90 }),
    ];
    const result = getSessions(entries, {
      agentId: "alpha",
      avgRiskTier: "critical",
      since: "24h",
    });
    expect(result.total).toBe(1);
    expect(result.sessions[0].sessionKey).toBe("match");
  });
});

describe("getSessions — pagination on filtered totals", () => {
  it("total reflects the FILTERED total, not the unfiltered count", () => {
    const entries = [
      // 3 alpha sessions
      entry({ sessionKey: "a1", agentId: "alpha", timestamp: "2026-03-29T10:00:00Z" }),
      entry({ sessionKey: "a2", agentId: "alpha", timestamp: "2026-03-29T11:00:00Z" }),
      entry({ sessionKey: "a3", agentId: "alpha", timestamp: "2026-03-29T12:00:00Z" }),
      // 2 beta sessions
      entry({ sessionKey: "b1", agentId: "beta", timestamp: "2026-03-29T10:00:00Z" }),
      entry({ sessionKey: "b2", agentId: "beta", timestamp: "2026-03-29T11:00:00Z" }),
    ];
    const result = getSessions(entries, { agentId: "alpha" }, 2, 0);
    expect(result.sessions).toHaveLength(2);
    expect(result.total).toBe(3); // filtered total, not 5
  });

  it("offset/limit slices the filtered list correctly", () => {
    const entries = [
      entry({ sessionKey: "a1", agentId: "alpha", timestamp: "2026-03-29T10:00:00Z" }),
      entry({ sessionKey: "a2", agentId: "alpha", timestamp: "2026-03-29T11:00:00Z" }),
      entry({ sessionKey: "a3", agentId: "alpha", timestamp: "2026-03-29T12:00:00Z" }),
    ];
    const result = getSessions(entries, { agentId: "alpha" }, 2, 2);
    expect(result.sessions).toHaveLength(1);
    expect(result.total).toBe(3);
  });
});

describe("getSessions — LIVE sessions pin to top (#53)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("LIVE session pins above a closed session even when its startTime is older than the closed end", () => {
    // Without LIVE-pin: closed_recent (endTime = NOW-6min) sorts above
    // live_old (startTime = NOW-25min) because the comparator falls back
    // to startTime for null-endTime rows. With the fix, live_old wins.
    const closedStart = new Date(NOW.getTime() - 7 * 60_000).toISOString();
    const closedEnd = new Date(NOW.getTime() - 6 * 60_000).toISOString();
    const liveOldStart = new Date(NOW.getTime() - 25 * 60_000).toISOString();
    const liveMid = new Date(NOW.getTime() - 10 * 60_000).toISOString();
    const liveLast = new Date(NOW.getTime() - 60_000).toISOString();
    const entries: AuditEntry[] = [
      entry({ sessionKey: "closed_recent", agentId: "a", timestamp: closedStart }),
      entry({ sessionKey: "closed_recent", agentId: "a", timestamp: closedEnd }),
      entry({ sessionKey: "live_old", agentId: "a", timestamp: liveOldStart }),
      entry({ sessionKey: "live_old", agentId: "a", timestamp: liveMid }),
      entry({ sessionKey: "live_old", agentId: "a", timestamp: liveLast }),
    ];
    const result = getSessions(entries);
    expect(result.sessions[0].sessionKey).toBe("live_old");
    expect(result.sessions[0].endTime).toBeNull();
    expect(result.sessions[1].sessionKey).toBe("closed_recent");
    expect(result.sessions[1].endTime).not.toBeNull();
  });

  it("among LIVE sessions, the most-recently-started sorts first", () => {
    const tenMinAgo = new Date(NOW.getTime() - 10 * 60_000).toISOString();
    const twoMinAgo = new Date(NOW.getTime() - 2 * 60_000).toISOString();
    const oneMinAgo = new Date(NOW.getTime() - 60_000).toISOString();
    const entries: AuditEntry[] = [
      // older LIVE
      entry({ sessionKey: "older_live", agentId: "a", timestamp: tenMinAgo }),
      entry({ sessionKey: "older_live", agentId: "a", timestamp: oneMinAgo }),
      // newer LIVE — started 2 min ago
      entry({ sessionKey: "newer_live", agentId: "a", timestamp: twoMinAgo }),
      entry({ sessionKey: "newer_live", agentId: "a", timestamp: oneMinAgo }),
    ];
    const result = getSessions(entries);
    expect(result.sessions[0].sessionKey).toBe("newer_live");
    expect(result.sessions[1].sessionKey).toBe("older_live");
  });

  it("peakRisk tiebreaker still wins for two LIVE sessions starting at the same moment", () => {
    const tenMinAgo = new Date(NOW.getTime() - 10 * 60_000).toISOString();
    const oneMinAgo = new Date(NOW.getTime() - 60_000).toISOString();
    const entries: AuditEntry[] = [
      entry({
        sessionKey: "calm_live",
        agentId: "a",
        timestamp: tenMinAgo,
        riskScore: 5,
      }),
      entry({
        sessionKey: "calm_live",
        agentId: "a",
        timestamp: oneMinAgo,
        riskScore: 5,
      }),
      entry({
        sessionKey: "wild_live",
        agentId: "b",
        timestamp: tenMinAgo,
        riskScore: 95,
      }),
      entry({
        sessionKey: "wild_live",
        agentId: "b",
        timestamp: oneMinAgo,
        riskScore: 95,
      }),
    ];
    const result = getSessions(entries);
    // Same startTime + both LIVE → peakRisk descending wins.
    expect(result.sessions[0].sessionKey).toBe("wild_live");
    expect(result.sessions[1].sessionKey).toBe("calm_live");
  });

  it("only-closed sessions sort newest end first (no regression)", () => {
    const entries: AuditEntry[] = [
      entry({
        sessionKey: "old_closed",
        agentId: "a",
        timestamp: "2026-03-29T08:00:00Z",
      }),
      entry({
        sessionKey: "new_closed",
        agentId: "a",
        timestamp: "2026-03-29T10:00:00Z",
      }),
    ];
    const result = getSessions(entries);
    expect(result.sessions[0].sessionKey).toBe("new_closed");
    expect(result.sessions[1].sessionKey).toBe("old_closed");
  });
});

describe("getSessions — sort tiebreaker", () => {
  it("sorts by peakRisk desc when endTimes are equal", () => {
    // Two sessions ending at the exact same timestamp — the riskier one wins.
    const entries = [
      entry({
        sessionKey: "calm",
        agentId: "alpha",
        timestamp: "2026-03-29T09:55:00Z",
        riskScore: 5,
      }),
      entry({
        sessionKey: "calm",
        agentId: "alpha",
        timestamp: "2026-03-29T10:00:00Z",
        riskScore: 5,
      }),
      entry({
        sessionKey: "wild",
        agentId: "beta",
        timestamp: "2026-03-29T09:55:00Z",
        riskScore: 95,
      }),
      entry({
        sessionKey: "wild",
        agentId: "beta",
        timestamp: "2026-03-29T10:00:00Z",
        riskScore: 95,
      }),
    ];
    const result = getSessions(entries);
    expect(result.sessions[0].sessionKey).toBe("wild");
    expect(result.sessions[1].sessionKey).toBe("calm");
  });
});
