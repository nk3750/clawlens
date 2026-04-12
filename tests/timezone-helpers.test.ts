import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditEntry } from "../src/audit/logger";
import {
  computeEnhancedStats,
  computeHistoricDailyMax,
  getAgents,
  localDateOf,
  localToday,
} from "../src/dashboard/api";

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

// ── localToday() ─────────────────────────────────────────

describe("localToday", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns YYYY-MM-DD format", () => {
    vi.setSystemTime(new Date(2026, 3, 12, 14, 30, 0)); // April 12, 2026 2:30pm local
    const result = localToday();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("matches the local date of the faked system time", () => {
    vi.setSystemTime(new Date(2026, 3, 12, 14, 30, 0)); // April 12, 2026 local
    expect(localToday()).toBe("2026-04-12");
  });

  it("zero-pads single-digit months and days", () => {
    vi.setSystemTime(new Date(2026, 0, 5, 10, 0, 0)); // Jan 5, 2026 local
    expect(localToday()).toBe("2026-01-05");
  });
});

// ── localDateOf() ────────────────────────────────────────

describe("localDateOf", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns YYYY-MM-DD format", () => {
    const result = localDateOf("2026-04-12T10:00:00Z");
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("extracts the local date from a UTC timestamp", () => {
    // Use a timestamp where local date is unambiguously the same
    vi.setSystemTime(new Date(2026, 3, 12, 12, 0, 0));
    const noon = new Date(2026, 3, 12, 12, 0, 0);
    expect(localDateOf(noon.toISOString())).toBe("2026-04-12");
  });

  it("is consistent with localToday() for a timestamp created at the same moment", () => {
    vi.setSystemTime(new Date(2026, 5, 15, 9, 0, 0)); // June 15 local
    const now = new Date();
    expect(localDateOf(now.toISOString())).toBe(localToday());
  });

  it("zero-pads single-digit months and days", () => {
    const d = new Date(2026, 0, 3, 12, 0, 0); // Jan 3 local, noon
    expect(localDateOf(d.toISOString())).toBe("2026-01-03");
  });
});

// ── getTodayEntries (calendar day via computeEnhancedStats) ──

describe("getTodayEntries — calendar day filtering", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("includes entries from earlier today (same calendar day)", () => {
    // Set time to 2pm local
    vi.setSystemTime(new Date(2026, 3, 12, 14, 0, 0));

    const earlyToday = new Date(2026, 3, 12, 1, 0, 0); // 1am local
    const midToday = new Date(2026, 3, 12, 10, 0, 0); // 10am local

    const entries = [
      entry({ decision: "allow", timestamp: earlyToday.toISOString() }),
      entry({ decision: "allow", timestamp: midToday.toISOString() }),
    ];

    const stats = computeEnhancedStats(entries);
    expect(stats.total).toBe(2);
  });

  it("excludes entries from yesterday (different calendar day)", () => {
    vi.setSystemTime(new Date(2026, 3, 12, 14, 0, 0));

    const yesterday = new Date(2026, 3, 11, 23, 0, 0); // yesterday 11pm local
    const todayEntry = new Date(2026, 3, 12, 10, 0, 0); // today 10am local

    const entries = [
      entry({ decision: "allow", timestamp: yesterday.toISOString() }),
      entry({ decision: "allow", timestamp: todayEntry.toISOString() }),
    ];

    const stats = computeEnhancedStats(entries);
    expect(stats.total).toBe(1);
  });

  it("does not shrink count over time (no rolling window)", () => {
    // Simulate an entry early in the day — it should stay counted all day
    vi.setSystemTime(new Date(2026, 3, 12, 8, 0, 0));

    const earlyEntry = new Date(2026, 3, 12, 0, 30, 0); // 12:30am local

    const entries = [entry({ decision: "allow", timestamp: earlyEntry.toISOString() })];

    // Count at 8am
    const stats8am = computeEnhancedStats(entries);
    expect(stats8am.total).toBe(1);

    // Advance to 11pm — same calendar day, count should not decrease
    vi.setSystemTime(new Date(2026, 3, 12, 23, 0, 0));
    const stats11pm = computeEnhancedStats(entries);
    expect(stats11pm.total).toBe(1);
  });
});

// ── getDayEntries (local date via computeHistoricDailyMax) ──

describe("getDayEntries — local date comparison", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("groups entries by local date for daily max calculation", () => {
    vi.setSystemTime(new Date(2026, 3, 12, 12, 0, 0));

    const day1a = new Date(2026, 3, 10, 9, 0, 0);
    const day1b = new Date(2026, 3, 10, 14, 0, 0);
    const day2a = new Date(2026, 3, 11, 10, 0, 0);

    const entries = [
      entry({ decision: "allow", timestamp: day1a.toISOString() }),
      entry({ decision: "allow", timestamp: day1b.toISOString() }),
      entry({ decision: "allow", timestamp: day2a.toISOString() }),
    ];

    // Day 1 has 2 entries, day 2 has 1 — max should be 2
    expect(computeHistoricDailyMax(entries)).toBe(2);
  });
});

// ── getAgents todayCutoff — local calendar day ──

describe("getAgents — local calendar day todayCutoff", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts only entries from current local calendar day", () => {
    vi.setSystemTime(new Date(2026, 2, 29, 14, 0, 0)); // March 29, 2pm local

    const yesterday = new Date(2026, 2, 28, 15, 0, 0); // yesterday 3pm
    const todayMorning = new Date(2026, 2, 29, 8, 0, 0);
    const todayNoon = new Date(2026, 2, 29, 12, 0, 0);

    const entries = [
      entry({ agentId: "bot-1", decision: "allow", timestamp: yesterday.toISOString() }),
      entry({ agentId: "bot-1", decision: "allow", timestamp: todayMorning.toISOString() }),
      entry({ agentId: "bot-1", decision: "allow", timestamp: todayNoon.toISOString() }),
    ];

    const agents = getAgents(entries);
    const bot = agents[0];
    expect(bot.todayToolCalls).toBe(2);
  });

  it("excludes yesterday entries even if within 24h", () => {
    // 2am local — an entry from yesterday 11pm is within 24h but different calendar day
    vi.setSystemTime(new Date(2026, 2, 29, 2, 0, 0));

    const yesterday11pm = new Date(2026, 2, 28, 23, 0, 0); // 3h ago, but yesterday
    const todayEntry = new Date(2026, 2, 29, 1, 0, 0); // 1h ago, today

    const entries = [
      entry({ agentId: "bot-1", decision: "allow", timestamp: yesterday11pm.toISOString() }),
      entry({ agentId: "bot-1", decision: "allow", timestamp: todayEntry.toISOString() }),
    ];

    const agents = getAgents(entries);
    const bot = agents[0];
    expect(bot.todayToolCalls).toBe(1);
  });
});

// ── Hourly histogram — local hours ──

describe("getAgents — hourly histogram uses local hours", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("buckets entries by local hour", () => {
    vi.setSystemTime(new Date(2026, 3, 12, 16, 0, 0)); // 4pm local

    const at9am = new Date(2026, 3, 12, 9, 0, 0);
    const at9amAlso = new Date(2026, 3, 12, 9, 30, 0);
    const at2pm = new Date(2026, 3, 12, 14, 0, 0);

    const entries = [
      entry({ agentId: "bot-1", decision: "allow", timestamp: at9am.toISOString() }),
      entry({ agentId: "bot-1", decision: "allow", timestamp: at9amAlso.toISOString() }),
      entry({ agentId: "bot-1", decision: "allow", timestamp: at2pm.toISOString() }),
    ];

    const agents = getAgents(entries);
    const bot = agents[0];

    // Hour 9 should have 2 entries, hour 14 should have 1
    expect(bot.hourlyActivity[9]).toBe(2);
    expect(bot.hourlyActivity[14]).toBe(1);
    // Other hours should be 0
    expect(bot.hourlyActivity[0]).toBe(0);
    expect(bot.hourlyActivity[12]).toBe(0);
  });
});

// ── computeEnhancedStats yesterdayTotal ──

describe("computeEnhancedStats — yesterdayTotal uses local dates", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calculates yesterday total from the previous local calendar day", () => {
    vi.setSystemTime(new Date(2026, 3, 12, 10, 0, 0)); // April 12, 10am local

    const yesterdayEntry = new Date(2026, 3, 11, 15, 0, 0); // April 11, 3pm local
    const todayEntry = new Date(2026, 3, 12, 8, 0, 0); // April 12, 8am local

    const entries = [
      entry({ decision: "allow", timestamp: yesterdayEntry.toISOString() }),
      entry({ decision: "allow", timestamp: todayEntry.toISOString() }),
    ];

    const stats = computeEnhancedStats(entries);
    expect(stats.yesterdayTotal).toBe(1);
    expect(stats.total).toBe(1);
  });
});
