// Unit tests for FleetChart/utils.ts helpers added in the polish pass.

import { describe, expect, it } from "vitest";
import {
  chipText,
  NOW_LABEL_GUARD_PX,
  surfacedChannelsForRow,
  VISIBLE_ROW_CAP_DESKTOP,
  VISIBLE_ROW_CAP_MOBILE,
} from "../dashboard/src/components/FleetChart/utils";
import type { TimelineSession } from "../dashboard/src/lib/types";

function session(partial: Partial<TimelineSession> = {}): TimelineSession {
  return {
    sessionKey: "agent:a1:main",
    agentId: "a1",
    startTime: "2026-04-19T10:00:00.000Z",
    endTime: "2026-04-19T10:00:01.000Z",
    segments: [],
    actionCount: 1,
    avgRisk: 0,
    peakRisk: 0,
    blockedCount: 0,
    isActive: false,
    ...partial,
  };
}

describe("surfacedChannelsForRow", () => {
  it("returns an empty array when all sessions are on the main channel", () => {
    const sessions = [
      session({ sessionKey: "agent:a1:main" }),
      session({ sessionKey: "agent:a1:main#2" }),
    ];
    expect(surfacedChannelsForRow("a1", sessions)).toEqual([]);
  });

  it("includes catalog channels (cron, telegram) but not main", () => {
    const sessions = [
      session({ sessionKey: "agent:a1:main" }),
      session({ sessionKey: "agent:a1:cron:job" }),
      session({ sessionKey: "agent:a1:telegram:chat" }),
    ];
    const ids = surfacedChannelsForRow("a1", sessions).map((c) => c.id);
    expect(ids).toContain("cron");
    expect(ids).toContain("telegram");
    expect(ids).not.toContain("main");
  });

  it("filters by agent — sessions for other agents are ignored", () => {
    const sessions = [
      session({ sessionKey: "agent:a1:cron:job", agentId: "a1" }),
      session({ sessionKey: "agent:other:telegram:chat", agentId: "other" }),
    ];
    const result = surfacedChannelsForRow("a1", sessions);
    const ids = result.map((c) => c.id);
    expect(ids).toEqual(["cron"]);
  });

  it("excludes 'unknown' channels (catalog miss without a usable id)", () => {
    // resolveChannel falls back to kind=unknown when the catalog has no entry,
    // but the helper must drop entries whose chipText would be empty too.
    const sessions = [
      session({ sessionKey: "agent:a1:cron:job" }),
      session({ sessionKey: "agent:a1::" }), // empty channel segment → empty id
    ];
    const result = surfacedChannelsForRow("a1", sessions);
    // cron should still surface; the empty-channel session is filtered out.
    const ids = result.map((c) => c.id);
    expect(ids).toContain("cron");
    expect(ids).not.toContain("");
  });

  it("returns channels in frequency order (most-frequent first)", () => {
    const sessions = [
      session({ sessionKey: "agent:a1:telegram:chat#1" }),
      session({ sessionKey: "agent:a1:cron:job#1" }),
      session({ sessionKey: "agent:a1:cron:job#2" }),
      session({ sessionKey: "agent:a1:cron:job#3" }),
    ];
    const ids = surfacedChannelsForRow("a1", sessions).map((c) => c.id);
    expect(ids[0]).toBe("cron");
    expect(ids[1]).toBe("telegram");
  });
});

describe("chipText", () => {
  it("uses the catalog shortLabel for known channels", () => {
    // cron -> the clock glyph (\u23F0)
    expect(chipText({ shortLabel: "\u23F0", id: "cron", kind: "schedule" })).toBe("\u23F0");
    // telegram -> "tg"
    expect(chipText({ shortLabel: "tg", id: "telegram", kind: "messaging" })).toBe("tg");
  });

  it("falls back to the full id for unknown channels (avoids 2-letter collisions)", () => {
    expect(chipText({ shortLabel: "ma", id: "maintenance", kind: "unknown" })).toBe("maint\u2026");
    expect(chipText({ shortLabel: "ma", id: "macro", kind: "unknown" })).toBe("macro");
  });

  it("returns the empty string when no usable identifier exists", () => {
    expect(chipText({ shortLabel: "", id: "", kind: "direct" })).toBe("");
  });
});

describe("polish constants", () => {
  it("exports a desktop visible row cap of 10 and mobile of 6", () => {
    expect(VISIBLE_ROW_CAP_DESKTOP).toBe(10);
    expect(VISIBLE_ROW_CAP_MOBILE).toBe(6);
  });

  it("exports a NOW label guard of 24px", () => {
    expect(NOW_LABEL_GUARD_PX).toBe(24);
  });
});
