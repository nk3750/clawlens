import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as crypto from "node:crypto";
import {
  computeStats,
  getRecentEntries,
  checkHealth,
  getEffectiveDecision,
} from "../src/dashboard/api";
import type { AuditEntry } from "../src/audit/logger";

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

describe("getEffectiveDecision", () => {
  it("maps userResponse over raw decision", () => {
    expect(getEffectiveDecision(entry({ decision: "approval_required", userResponse: "approved" }))).toBe("approved");
    expect(getEffectiveDecision(entry({ decision: "approval_required", userResponse: "denied" }))).toBe("denied");
    expect(getEffectiveDecision(entry({ decision: "approval_required", userResponse: "timeout" }))).toBe("timeout");
  });

  it("maps raw decisions when no userResponse", () => {
    expect(getEffectiveDecision(entry({ decision: "allow" }))).toBe("allow");
    expect(getEffectiveDecision(entry({ decision: "block" }))).toBe("block");
    expect(getEffectiveDecision(entry({ decision: "approval_required" }))).toBe("pending");
  });

  it("falls back to executionResult for result entries", () => {
    expect(getEffectiveDecision(entry({ executionResult: "success" }))).toBe("success");
    expect(getEffectiveDecision(entry({ executionResult: "failure" }))).toBe("failure");
  });

  it("returns unknown for entries with no decision info", () => {
    expect(getEffectiveDecision(entry())).toBe("unknown");
  });
});

describe("computeStats", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-29T14:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns zeros for empty entries", () => {
    const stats = computeStats([]);
    expect(stats).toEqual({
      total: 0,
      allowed: 0,
      approved: 0,
      blocked: 0,
      timedOut: 0,
      pending: 0,
    });
  });

  it("counts allowed, blocked, approved, timedOut correctly", () => {
    const entries: AuditEntry[] = [
      entry({ timestamp: "2026-03-29T10:00:00Z", decision: "allow" }),
      entry({ timestamp: "2026-03-29T10:01:00Z", decision: "allow" }),
      entry({ timestamp: "2026-03-29T10:02:00Z", decision: "block" }),
      entry({ timestamp: "2026-03-29T10:03:00Z", decision: "allow", userResponse: "approved" }),
      entry({ timestamp: "2026-03-29T10:04:00Z", decision: "block", userResponse: "denied" }),
      entry({ timestamp: "2026-03-29T10:05:00Z", decision: "approval_required", userResponse: "timeout" }),
      entry({ timestamp: "2026-03-29T10:06:00Z", decision: "approval_required" }),
    ];

    const stats = computeStats(entries);
    expect(stats.allowed).toBe(2);
    expect(stats.approved).toBe(1);
    expect(stats.blocked).toBe(2); // 1 block + 1 denied
    expect(stats.timedOut).toBe(1);
    expect(stats.pending).toBe(1);
    expect(stats.total).toBe(6); // total excludes pending
  });

  it("only counts entries from today (UTC)", () => {
    const entries: AuditEntry[] = [
      entry({ timestamp: "2026-03-28T23:59:59Z", decision: "allow" }), // yesterday
      entry({ timestamp: "2026-03-29T00:00:00Z", decision: "allow" }), // today
      entry({ timestamp: "2026-03-29T13:00:00Z", decision: "block" }), // today
    ];

    const stats = computeStats(entries);
    expect(stats.total).toBe(2);
    expect(stats.allowed).toBe(1);
    expect(stats.blocked).toBe(1);
  });

  it("excludes result entries (no decision field)", () => {
    const entries: AuditEntry[] = [
      entry({ timestamp: "2026-03-29T10:00:00Z", decision: "allow" }),
      entry({ timestamp: "2026-03-29T10:01:00Z", executionResult: "success" }), // no decision
    ];

    const stats = computeStats(entries);
    expect(stats.total).toBe(1);
    expect(stats.allowed).toBe(1);
  });
});

describe("getRecentEntries", () => {
  const entries: AuditEntry[] = [
    entry({ timestamp: "2026-03-29T10:00:00Z", toolName: "read", decision: "allow" }),
    entry({ timestamp: "2026-03-29T10:01:00Z", toolName: "write", decision: "block" }),
    entry({ timestamp: "2026-03-29T10:02:00Z", toolName: "exec", decision: "allow" }),
    entry({ timestamp: "2026-03-29T10:03:00Z", toolName: "message", decision: "approval_required", userResponse: "approved" }),
    // Result entry — should be excluded
    entry({ timestamp: "2026-03-29T10:04:00Z", toolName: "exec", executionResult: "success" }),
  ];

  it("returns entries in reverse chronological order", () => {
    const result = getRecentEntries(entries, 50, 0);
    expect(result).toHaveLength(4); // excludes result entry
    expect(result[0].toolName).toBe("message");
    expect(result[1].toolName).toBe("exec");
    expect(result[2].toolName).toBe("write");
    expect(result[3].toolName).toBe("read");
  });

  it("respects limit parameter", () => {
    const result = getRecentEntries(entries, 2, 0);
    expect(result).toHaveLength(2);
    expect(result[0].toolName).toBe("message");
    expect(result[1].toolName).toBe("exec");
  });

  it("respects offset parameter", () => {
    const result = getRecentEntries(entries, 2, 2);
    expect(result).toHaveLength(2);
    expect(result[0].toolName).toBe("write");
    expect(result[1].toolName).toBe("read");
  });

  it("includes effectiveDecision on each entry", () => {
    const result = getRecentEntries(entries, 50, 0);
    expect(result[0].effectiveDecision).toBe("approved");
    expect(result[1].effectiveDecision).toBe("allow");
    expect(result[2].effectiveDecision).toBe("block");
    expect(result[3].effectiveDecision).toBe("allow");
  });

  it("returns empty array for empty input", () => {
    expect(getRecentEntries([], 50, 0)).toEqual([]);
  });
});

describe("checkHealth", () => {
  it("returns valid:true and count for empty entries", () => {
    const result = checkHealth([]);
    expect(result).toEqual({ valid: true, totalEntries: 0 });
  });

  it("returns valid:true for intact chain", () => {
    function buildChain(count: number): AuditEntry[] {
      const chain: AuditEntry[] = [];
      let prevHash = "0";
      for (let i = 0; i < count; i++) {
        const base = {
          timestamp: `2026-03-29T10:0${i}:00Z`,
          toolName: "exec",
          params: {},
          decision: "allow" as const,
          prevHash,
        };
        const hash = crypto
          .createHash("sha256")
          .update(JSON.stringify(base))
          .digest("hex");
        chain.push({ ...base, hash });
        prevHash = hash;
      }
      return chain;
    }

    const chain = buildChain(3);
    const result = checkHealth(chain);
    expect(result.valid).toBe(true);
    expect(result.totalEntries).toBe(3);
  });

  it("returns valid:false with brokenAt for tampered chain", () => {
    const e1base = {
      timestamp: "2026-03-29T10:00:00Z",
      toolName: "exec",
      params: {},
      decision: "allow" as const,
      prevHash: "0",
    };
    const e1hash = crypto.createHash("sha256").update(JSON.stringify(e1base)).digest("hex");
    const e1: AuditEntry = { ...e1base, hash: e1hash };

    const e2: AuditEntry = {
      timestamp: "2026-03-29T10:01:00Z",
      toolName: "exec",
      params: {},
      decision: "allow",
      prevHash: "wrong-hash", // broken link
      hash: "fake",
    };

    const result = checkHealth([e1, e2]);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(1);
    expect(result.totalEntries).toBe(2);
  });
});
