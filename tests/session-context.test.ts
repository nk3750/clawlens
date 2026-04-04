import { describe, it, expect, beforeEach } from "vitest";
import { SessionContext } from "../src/risk/session-context";

describe("SessionContext", () => {
  let ctx: SessionContext;

  beforeEach(() => {
    ctx = new SessionContext();
  });

  it("records and retrieves actions", () => {
    ctx.record("s1", {
      toolName: "exec",
      params: { command: "ls" },
      riskScore: 70,
      timestamp: "2026-04-04T10:00:00Z",
    });

    const recent = ctx.getRecent("s1", 5);
    expect(recent).toHaveLength(1);
    expect(recent[0].toolName).toBe("exec");
  });

  it("returns last N actions", () => {
    for (let i = 0; i < 10; i++) {
      ctx.record("s1", {
        toolName: `tool-${i}`,
        params: {},
        riskScore: i * 10,
        timestamp: `2026-04-04T10:0${i}:00Z`,
      });
    }

    const recent = ctx.getRecent("s1", 3);
    expect(recent).toHaveLength(3);
    expect(recent[0].toolName).toBe("tool-7");
    expect(recent[1].toolName).toBe("tool-8");
    expect(recent[2].toolName).toBe("tool-9");
  });

  it("returns empty array for unknown session", () => {
    expect(ctx.getRecent("nonexistent", 5)).toEqual([]);
  });

  it("tracks sessions independently", () => {
    ctx.record("s1", {
      toolName: "read",
      params: {},
      riskScore: 5,
      timestamp: "2026-04-04T10:00:00Z",
    });
    ctx.record("s2", {
      toolName: "exec",
      params: {},
      riskScore: 70,
      timestamp: "2026-04-04T10:00:00Z",
    });

    expect(ctx.getRecent("s1", 5)).toHaveLength(1);
    expect(ctx.getRecent("s1", 5)[0].toolName).toBe("read");
    expect(ctx.getRecent("s2", 5)).toHaveLength(1);
    expect(ctx.getRecent("s2", 5)[0].toolName).toBe("exec");
  });

  it("cleans up a specific session", () => {
    ctx.record("s1", {
      toolName: "read",
      params: {},
      riskScore: 5,
      timestamp: "2026-04-04T10:00:00Z",
    });
    ctx.record("s2", {
      toolName: "exec",
      params: {},
      riskScore: 70,
      timestamp: "2026-04-04T10:00:00Z",
    });

    ctx.cleanup("s1");

    expect(ctx.getRecent("s1", 5)).toEqual([]);
    expect(ctx.getRecent("s2", 5)).toHaveLength(1);
    expect(ctx.size).toBe(1);
  });

  it("handles cleanup of nonexistent session", () => {
    ctx.cleanup("nonexistent"); // should not throw
    expect(ctx.size).toBe(0);
  });

  it("returns all when count exceeds recorded actions", () => {
    ctx.record("s1", {
      toolName: "read",
      params: {},
      riskScore: 5,
      timestamp: "2026-04-04T10:00:00Z",
    });

    const recent = ctx.getRecent("s1", 100);
    expect(recent).toHaveLength(1);
  });
});
