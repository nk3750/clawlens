import { describe, expect, it } from "vitest";
import type { AuditEntry } from "../src/audit/logger";
import { deriveScheduleLabel, extractCronRunStarts } from "../src/dashboard/cadence";

function entry(
  overrides: Partial<AuditEntry> & { timestamp: string; sessionKey: string },
): AuditEntry {
  return {
    toolName: "exec",
    params: {},
    hash: "h",
    prevHash: "p",
    ...overrides,
  } as AuditEntry;
}

function fill(sessionKey: string, startMs: number, gapMs: number, count: number): AuditEntry[] {
  const out: AuditEntry[] = [];
  for (let i = 0; i < count; i++) {
    out.push(entry({ sessionKey, timestamp: new Date(startMs + i * gapMs).toISOString() }));
  }
  return out;
}

describe("deriveScheduleLabel", () => {
  it("returns the 8-hour interval from three evenly spaced starts", () => {
    const starts = ["2026-04-16T23:05:00Z", "2026-04-16T15:05:00Z", "2026-04-16T07:05:00Z"];
    expect(deriveScheduleLabel("scheduled", starts)).toBe("every 8h");
  });

  it("returns 'daily' when interval is approximately 24h", () => {
    const starts = ["2026-04-16T09:00:00Z", "2026-04-15T09:00:00Z", "2026-04-14T09:00:00Z"];
    expect(deriveScheduleLabel("scheduled", starts)).toBe("daily");
  });

  it("returns 'every Nm' for minute-level cadence", () => {
    const starts = [
      "2026-04-16T12:15:00Z",
      "2026-04-16T12:10:00Z",
      "2026-04-16T12:05:00Z",
      "2026-04-16T12:00:00Z",
    ];
    expect(deriveScheduleLabel("scheduled", starts)).toBe("every 5m");
  });

  it("returns 'every Nd' for multi-day cadence", () => {
    const starts = ["2026-04-16T12:00:00Z", "2026-04-13T12:00:00Z", "2026-04-10T12:00:00Z"];
    expect(deriveScheduleLabel("scheduled", starts)).toBe("every 3d");
  });

  it("returns null for interactive mode", () => {
    const starts = ["2026-04-16T12:15:00Z", "2026-04-16T12:10:00Z"];
    expect(deriveScheduleLabel("interactive", starts)).toBeNull();
  });

  it("returns null with fewer than 2 starts", () => {
    expect(deriveScheduleLabel("scheduled", [])).toBeNull();
    expect(deriveScheduleLabel("scheduled", ["2026-04-16T12:00:00Z"])).toBeNull();
  });

  it("prefers an explicit schedule over inference", () => {
    expect(deriveScheduleLabel("scheduled", [], "every 30m")).toBe("every 30m");
    // even in interactive mode, explicit wins
    expect(deriveScheduleLabel("interactive", [], "manual")).toBe("manual");
  });

  it("handles unsorted input (order-agnostic)", () => {
    const starts = ["2026-04-16T07:05:00Z", "2026-04-16T23:05:00Z", "2026-04-16T15:05:00Z"];
    expect(deriveScheduleLabel("scheduled", starts)).toBe("every 8h");
  });

  it("uses the median when intervals vary slightly", () => {
    // 8h, 8h, 7h59m — median should still round to 8h
    const starts = [
      "2026-04-17T00:00:00Z",
      "2026-04-16T16:00:00Z",
      "2026-04-16T08:00:00Z",
      "2026-04-16T00:01:00Z",
    ];
    expect(deriveScheduleLabel("scheduled", starts)).toBe("every 8h");
  });
});

describe("extractCronRunStarts — adaptive run-boundary", () => {
  const KEY = "agent:x:cron:job-001";
  const OTHER = "agent:x:main";
  const T0 = Date.parse("2026-04-16T00:00:00Z");

  it("returns empty when no cron entries present", () => {
    expect(
      extractCronRunStarts([entry({ sessionKey: OTHER, timestamp: new Date(T0).toISOString() })]),
    ).toEqual([]);
  });

  it("treats a single cron entry as one run", () => {
    const starts = extractCronRunStarts(fill(KEY, T0, 0, 1));
    expect(starts).toHaveLength(1);
    expect(starts[0]).toBe(new Date(T0).toISOString());
  });

  it("fast agent + frequent cron (3s intra, 5min inter) resolves as expected", () => {
    // Run 1: T0, T0+3s, T0+6s. Run 2: T0+5min, +3s, +6s.
    const run1 = fill(KEY, T0, 3_000, 3);
    const run2 = fill(KEY, T0 + 5 * 60_000, 3_000, 3);
    const starts = extractCronRunStarts([...run1, ...run2]);
    expect(starts).toHaveLength(2);
    expect(starts[0]).toBe(new Date(T0).toISOString());
    expect(starts[1]).toBe(new Date(T0 + 5 * 60_000).toISOString());
  });

  it("slow agent + slow cron (60s intra, 1h inter) stays one run per cron tick — the naive 30s threshold would mis-split", () => {
    // Each run: 4 entries separated by 60s. Two runs 1h apart.
    const run1 = fill(KEY, T0, 60_000, 4);
    const run2 = fill(KEY, T0 + 3_600_000, 60_000, 4);
    const starts = extractCronRunStarts([...run1, ...run2]);
    expect(starts).toHaveLength(2);
    expect(starts[0]).toBe(new Date(T0).toISOString());
    expect(starts[1]).toBe(new Date(T0 + 3_600_000).toISOString());
  });

  it("sparse cron (single entry per run, 6h apart) picks up every start", () => {
    const entries = [
      entry({ sessionKey: KEY, timestamp: new Date(T0).toISOString() }),
      entry({ sessionKey: KEY, timestamp: new Date(T0 + 6 * 3_600_000).toISOString() }),
      entry({ sessionKey: KEY, timestamp: new Date(T0 + 12 * 3_600_000).toISOString() }),
    ];
    expect(extractCronRunStarts(entries)).toHaveLength(3);
  });

  it("separates different cron jobs on the same agent", () => {
    const KEY_A = "agent:x:cron:job-a";
    const KEY_B = "agent:x:cron:job-b";
    const entries = [...fill(KEY_A, T0, 2_000, 3), ...fill(KEY_B, T0 + 1_000, 2_000, 3)];
    const starts = extractCronRunStarts(entries);
    expect(starts).toHaveLength(2); // one run each
  });

  it("ignores non-cron session keys", () => {
    const entries = [
      ...fill(KEY, T0, 2_000, 2),
      ...fill("agent:x:telegram:direct:42", T0, 2_000, 5),
      ...fill("agent:x:main", T0, 2_000, 5),
    ];
    const starts = extractCronRunStarts(entries);
    // Only the cron-keyed entries contribute — one run.
    expect(starts).toHaveLength(1);
  });

  it("clamps threshold to the 30-min ceiling (extremely slow agents don't eat genuine hourly boundaries)", () => {
    // Intra-run median = 20min → 5× = 100min, but we ceiling at 30min.
    // So a 45-min gap > 30min threshold still counts as a new run.
    const entries = [
      entry({ sessionKey: KEY, timestamp: new Date(T0).toISOString() }),
      entry({ sessionKey: KEY, timestamp: new Date(T0 + 20 * 60_000).toISOString() }),
      entry({ sessionKey: KEY, timestamp: new Date(T0 + 40 * 60_000).toISOString() }),
      // 45-min gap — new run
      entry({ sessionKey: KEY, timestamp: new Date(T0 + 85 * 60_000).toISOString() }),
      entry({ sessionKey: KEY, timestamp: new Date(T0 + 105 * 60_000).toISOString() }),
    ];
    const starts = extractCronRunStarts(entries);
    expect(starts).toHaveLength(2);
    expect(starts[1]).toBe(new Date(T0 + 85 * 60_000).toISOString());
  });

  it("honors the 30s floor so a fast agent's tiny gaps don't split runs on noise", () => {
    // Median intra gap = 1s → 5× = 5s, but floor clamps to 30s.
    // So a 10s pause is still within one run.
    const entries = [
      entry({ sessionKey: KEY, timestamp: new Date(T0).toISOString() }),
      entry({ sessionKey: KEY, timestamp: new Date(T0 + 1_000).toISOString() }),
      entry({ sessionKey: KEY, timestamp: new Date(T0 + 2_000).toISOString() }),
      // 10s pause — still same run under 30s floor
      entry({ sessionKey: KEY, timestamp: new Date(T0 + 12_000).toISOString() }),
      entry({ sessionKey: KEY, timestamp: new Date(T0 + 13_000).toISOString() }),
    ];
    expect(extractCronRunStarts(entries)).toHaveLength(1);
  });
});
