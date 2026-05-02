import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  applyClientFilter,
  filtersToSearchParams,
  PRESETS,
  parseFiltersFromURL,
  presetMatches,
  type SessionFilters,
} from "../dashboard/src/lib/sessionFilters";
import type { ActivityCategory, SessionInfo } from "../dashboard/src/lib/types";

function session(overrides: Partial<SessionInfo> = {}): SessionInfo {
  const breakdown: Record<ActivityCategory, number> = {
    exploring: 0,
    changes: 0,
    git: 0,
    scripts: 0,
    web: 0,
    comms: 0,
    orchestration: 0,
    media: 0,
  };
  return {
    sessionKey: "s1",
    agentId: "alpha",
    startTime: "2026-04-26T17:00:00.000Z",
    endTime: "2026-04-26T17:05:00.000Z",
    duration: 5 * 60_000,
    toolCallCount: 3,
    avgRisk: 30,
    peakRisk: 50,
    activityBreakdown: breakdown,
    blockedCount: 0,
    toolSummary: [],
    riskSparkline: [10, 30, 50],
    ...overrides,
  };
}

describe("sessionFilters — parseFiltersFromURL", () => {
  it("extracts agent / risk / duration / since / view", () => {
    const params = new URLSearchParams("agent=alpha&risk=high&duration=lt1m&since=24h&view=live");
    const filters = parseFiltersFromURL(params);
    expect(filters).toEqual({
      agent: "alpha",
      risk: "high",
      duration: "lt1m",
      since: "24h",
      view: "live",
    });
  });

  it("returns empty object for empty URL", () => {
    expect(parseFiltersFromURL(new URLSearchParams())).toEqual({});
  });

  it("preserves unknown values (chip path can render them)", () => {
    const params = new URLSearchParams("risk=banana");
    expect(parseFiltersFromURL(params)).toEqual({ risk: "banana" });
  });
});

describe("sessionFilters — filtersToSearchParams", () => {
  it("round-trips a populated filter set", () => {
    const filters: SessionFilters = {
      agent: "alpha",
      risk: "high",
      duration: "1to10m",
      since: "6h",
    };
    const params = filtersToSearchParams(filters);
    expect(parseFiltersFromURL(params)).toEqual(filters);
  });

  it("omits empty values", () => {
    const params = filtersToSearchParams({ risk: "" });
    expect(params.toString()).toBe("");
  });
});

describe("sessionFilters — activeFilterCount", () => {
  it("counts only populated filter keys", () => {
    expect(activeFilterCount({})).toBe(0);
    expect(activeFilterCount({ agent: "alpha" })).toBe(1);
    expect(activeFilterCount({ agent: "alpha", risk: "high" })).toBe(2);
  });
});

describe("sessionFilters — PRESETS", () => {
  it("includes the five v1 presets in spec §5.3 order", () => {
    expect(PRESETS.map((p) => p.id)).toEqual([
      "all",
      "live-now",
      "high-risk-only",
      "with-blocks",
      "last-hour",
    ]);
  });

  it("live-now preset uses view=live", () => {
    const live = PRESETS.find((p) => p.id === "live-now");
    expect(live?.filters).toEqual({ view: "live" });
  });

  it("with-blocks preset uses view=blocks", () => {
    const blocks = PRESETS.find((p) => p.id === "with-blocks");
    expect(blocks?.filters).toEqual({ view: "blocks" });
  });

  it("high-risk-only preset uses risk=high", () => {
    const hr = PRESETS.find((p) => p.id === "high-risk-only");
    expect(hr?.filters).toEqual({ risk: "high" });
  });

  it("last-hour preset uses since=1h", () => {
    const lh = PRESETS.find((p) => p.id === "last-hour");
    expect(lh?.filters).toEqual({ since: "1h" });
  });
});

describe("sessionFilters — presetMatches", () => {
  it("treats matching filter shapes as equal", () => {
    const preset = PRESETS.find((p) => p.id === "high-risk-only")!;
    expect(presetMatches(preset, { risk: "high" })).toBe(true);
  });

  it("rejects non-matching shapes", () => {
    const preset = PRESETS.find((p) => p.id === "high-risk-only")!;
    expect(presetMatches(preset, { risk: "high", agent: "alpha" })).toBe(false);
  });
});

describe("sessionFilters — applyClientFilter (view=live / view=blocks)", () => {
  it("view=live keeps only sessions with endTime === null", () => {
    const sessions: SessionInfo[] = [
      session({ sessionKey: "live", endTime: null, duration: null }),
      session({ sessionKey: "closed" }),
    ];
    const result = applyClientFilter(sessions, { view: "live" });
    expect(result.map((s) => s.sessionKey)).toEqual(["live"]);
  });

  it("view=blocks keeps only sessions with blockedCount > 0", () => {
    const sessions: SessionInfo[] = [
      session({ sessionKey: "blocked", blockedCount: 2 }),
      session({ sessionKey: "clean", blockedCount: 0 }),
    ];
    const result = applyClientFilter(sessions, { view: "blocks" });
    expect(result.map((s) => s.sessionKey)).toEqual(["blocked"]);
  });

  it("no view filter passes everything through", () => {
    const sessions: SessionInfo[] = [session({ sessionKey: "a" }), session({ sessionKey: "b" })];
    expect(applyClientFilter(sessions, {})).toHaveLength(2);
  });

  it("unknown view value passes everything through (forgiving)", () => {
    const sessions: SessionInfo[] = [session({ sessionKey: "a" }), session({ sessionKey: "b" })];
    expect(applyClientFilter(sessions, { view: "banana" })).toHaveLength(2);
  });
});
