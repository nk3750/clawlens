import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activeFilterCount,
  applyFilters,
  countWith,
  type Filters,
  filtersToSearchParams,
  matchesFilters,
  PRESETS,
  parseFiltersFromURL,
  presetMatches,
  tierToRiskTier,
} from "../dashboard/src/lib/activityFilters";
import type { ActivityCategory, EntryResponse } from "../dashboard/src/lib/types";

const NOW = new Date("2026-04-26T18:00:00.000Z").getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

function entry(overrides: Partial<EntryResponse>): EntryResponse {
  return {
    timestamp: new Date(NOW - 5 * 60_000).toISOString(),
    toolName: "exec",
    params: {},
    effectiveDecision: "allow",
    category: "scripts" as ActivityCategory,
    ...overrides,
  };
}

describe("matchesFilters / applyFilters", () => {
  const fixtures: EntryResponse[] = [
    entry({
      toolCallId: "a1",
      agentId: "baddie",
      category: "scripts",
      riskTier: "critical",
      effectiveDecision: "block",
      timestamp: new Date(NOW - 30 * 60_000).toISOString(),
    }),
    entry({
      toolCallId: "a2",
      agentId: "baddie",
      category: "git",
      riskTier: "low",
      effectiveDecision: "allow",
      timestamp: new Date(NOW - 2 * 60_000).toISOString(),
    }),
    entry({
      toolCallId: "a3",
      agentId: "seo-growth",
      category: "scripts",
      riskTier: "high",
      effectiveDecision: "pending",
      timestamp: new Date(NOW - 7 * 3600_000).toISOString(),
    }),
    entry({
      toolCallId: "a4",
      // no agentId — should default to "default"
      agentId: undefined,
      category: "exploring",
      riskTier: "medium",
      effectiveDecision: "allow",
      timestamp: new Date(NOW - 50 * 60_000).toISOString(),
    }),
    entry({
      toolCallId: "a5",
      agentId: "seo-growth",
      category: "web",
      // no riskTier — post-#33 some entries lack tier
      riskTier: undefined,
      effectiveDecision: "allow",
      timestamp: new Date(NOW - 30 * 1000).toISOString(),
    }),
  ];

  it("returns all entries for empty filters", () => {
    expect(applyFilters(fixtures, {})).toHaveLength(5);
  });

  it("filters by agent", () => {
    const out = applyFilters(fixtures, { agent: "baddie" });
    expect(out.map((e) => e.toolCallId)).toEqual(["a1", "a2"]);
  });

  it("treats missing agentId as 'default'", () => {
    const out = applyFilters(fixtures, { agent: "default" });
    expect(out.map((e) => e.toolCallId)).toEqual(["a4"]);
  });

  it("filters by category", () => {
    const out = applyFilters(fixtures, { category: "scripts" });
    expect(out.map((e) => e.toolCallId)).toEqual(["a1", "a3"]);
  });

  it("filters by tier (matches entry.riskTier)", () => {
    const out = applyFilters(fixtures, { tier: "critical" });
    expect(out.map((e) => e.toolCallId)).toEqual(["a1"]);
  });

  it("entries with no tier are excluded when tier filter is active", () => {
    const out = applyFilters(fixtures, { tier: "low" });
    // a5 has no riskTier — must NOT be included, even though the spec says
    // such rows render with no badge in the feed.
    expect(out.map((e) => e.toolCallId)).toEqual(["a2"]);
  });

  it("filters by decision", () => {
    expect(applyFilters(fixtures, { decision: "block" }).map((e) => e.toolCallId)).toEqual(["a1"]);
    expect(applyFilters(fixtures, { decision: "pending" }).map((e) => e.toolCallId)).toEqual([
      "a3",
    ]);
    expect(
      applyFilters(fixtures, { decision: "allow" })
        .map((e) => e.toolCallId)
        .sort(),
    ).toEqual(["a2", "a4", "a5"]);
  });

  it("filters by since=1h", () => {
    const out = applyFilters(fixtures, { since: "1h" });
    // Within last hour: a1 (30m), a2 (2m), a4 (50m), a5 (30s). a3 is 7h old.
    expect(out.map((e) => e.toolCallId).sort()).toEqual(["a1", "a2", "a4", "a5"]);
  });

  it("filters by since=6h", () => {
    const out = applyFilters(fixtures, { since: "6h" });
    expect(out.map((e) => e.toolCallId).sort()).toEqual(["a1", "a2", "a4", "a5"]);
  });

  it("filters by since=24h includes all of today", () => {
    expect(applyFilters(fixtures, { since: "24h" })).toHaveLength(5);
  });

  it("since=all is a no-op time filter", () => {
    expect(applyFilters(fixtures, { since: "all" })).toHaveLength(5);
  });

  it("unknown since value is ignored (no time filter applied)", () => {
    // Mirrors backend: getRecentEntries silently skips unknown since values.
    expect(applyFilters(fixtures, { since: "banana" })).toHaveLength(5);
  });

  it("intersects multiple filters", () => {
    const out = applyFilters(fixtures, { agent: "baddie", category: "scripts", since: "1h" });
    expect(out.map((e) => e.toolCallId)).toEqual(["a1"]);
  });

  it("unknown tier value yields zero rows (no crash)", () => {
    expect(applyFilters(fixtures, { tier: "banana" })).toEqual([]);
  });

  it("unknown agent value yields zero rows", () => {
    expect(applyFilters(fixtures, { agent: "ghost" })).toEqual([]);
  });

  it("matchesFilters checks a single entry", () => {
    expect(matchesFilters(fixtures[0], { tier: "critical" })).toBe(true);
    expect(matchesFilters(fixtures[0], { tier: "low" })).toBe(false);
    expect(matchesFilters(fixtures[0], {})).toBe(true);
  });
});

describe("countWith", () => {
  const rows: EntryResponse[] = [
    entry({ toolCallId: "c1", agentId: "alpha", riskTier: "high" }),
    entry({ toolCallId: "c2", agentId: "alpha", riskTier: "low" }),
    entry({ toolCallId: "c3", agentId: "beta", riskTier: "high" }),
  ];

  it("returns count of matching rows", () => {
    expect(countWith(rows, { agent: "alpha" })).toBe(2);
    expect(countWith(rows, { tier: "high" })).toBe(2);
    expect(countWith(rows, { agent: "alpha", tier: "high" })).toBe(1);
  });

  it("returns 0 when no rows match (used to disable rail options)", () => {
    expect(countWith(rows, { agent: "ghost" })).toBe(0);
  });

  it("returns total when filters empty", () => {
    expect(countWith(rows, {})).toBe(3);
  });
});

describe("parseFiltersFromURL", () => {
  it("returns empty object for empty params", () => {
    expect(parseFiltersFromURL(new URLSearchParams(""))).toEqual({});
  });

  it("parses each known key", () => {
    const p = new URLSearchParams(
      "tier=high&agent=baddie&category=scripts&decision=block&since=24h",
    );
    expect(parseFiltersFromURL(p)).toEqual({
      tier: "high",
      agent: "baddie",
      category: "scripts",
      decision: "block",
      since: "24h",
    });
  });

  it("ignores unknown keys", () => {
    expect(parseFiltersFromURL(new URLSearchParams("foo=bar&tier=high"))).toEqual({ tier: "high" });
  });

  it("treats empty values as absent", () => {
    expect(parseFiltersFromURL(new URLSearchParams("tier=&agent=foo"))).toEqual({ agent: "foo" });
  });

  it("preserves unknown filter values (so the chip can surface them)", () => {
    // ?tier=banana — render the chip; counts return 0; user can clear.
    expect(parseFiltersFromURL(new URLSearchParams("tier=banana"))).toEqual({ tier: "banana" });
  });
});

describe("filtersToSearchParams", () => {
  it("serializes only defined non-empty values", () => {
    const params = filtersToSearchParams({ tier: "high", agent: "" });
    expect(params.toString()).toBe("tier=high");
  });

  it("omits empty object", () => {
    expect(filtersToSearchParams({}).toString()).toBe("");
  });

  it("URL-encodes values", () => {
    const params = filtersToSearchParams({ agent: "agent with spaces/slash" });
    expect(params.get("agent")).toBe("agent with spaces/slash");
    expect(params.toString()).toContain("agent");
  });

  it("round-trips with parseFiltersFromURL", () => {
    const original: Filters = {
      tier: "critical",
      agent: "baddie",
      category: "scripts",
      decision: "block",
      since: "24h",
    };
    const round = parseFiltersFromURL(filtersToSearchParams(original));
    expect(round).toEqual(original);
  });
});

describe("activeFilterCount", () => {
  it("returns 0 for empty filters", () => {
    expect(activeFilterCount({})).toBe(0);
  });

  it("counts only defined non-empty values", () => {
    expect(activeFilterCount({ tier: "high" })).toBe(1);
    expect(activeFilterCount({ tier: "high", agent: "baddie" })).toBe(2);
    expect(activeFilterCount({ tier: "", agent: undefined })).toBe(0);
  });

  it("ignores extra keys", () => {
    // Only canonical keys count toward active state.
    const filters = { tier: "high", random: "ignored" } as unknown as Filters;
    expect(activeFilterCount(filters)).toBe(1);
  });
});

describe("tierToRiskTier", () => {
  it("returns the same value for valid tiers", () => {
    expect(tierToRiskTier("low")).toBe("low");
    expect(tierToRiskTier("medium")).toBe("medium");
    expect(tierToRiskTier("high")).toBe("high");
    expect(tierToRiskTier("critical")).toBe("critical");
  });

  it("returns undefined for invalid or missing values", () => {
    expect(tierToRiskTier(undefined)).toBeUndefined();
    expect(tierToRiskTier("")).toBeUndefined();
    expect(tierToRiskTier("banana")).toBeUndefined();
    expect(tierToRiskTier("crit")).toBeUndefined(); // design used short names; ours doesn't.
  });
});

describe("PRESETS", () => {
  it("has the six expected presets in order", () => {
    expect(PRESETS.map((p) => p.id)).toEqual([
      "all",
      "critical-only",
      "high-risk-only",
      "pending-approvals",
      "blocks-today",
      "last-hour",
    ]);
  });

  it("'all' has empty filters", () => {
    expect(PRESETS[0].filters).toEqual({});
  });

  it("each non-'all' preset matches a stable shape", () => {
    expect(PRESETS.find((p) => p.id === "critical-only")?.filters).toEqual({ tier: "critical" });
    expect(PRESETS.find((p) => p.id === "high-risk-only")?.filters).toEqual({ tier: "high" });
    expect(PRESETS.find((p) => p.id === "pending-approvals")?.filters).toEqual({
      decision: "pending",
    });
    expect(PRESETS.find((p) => p.id === "blocks-today")?.filters).toEqual({
      decision: "block",
      since: "24h",
    });
    expect(PRESETS.find((p) => p.id === "last-hour")?.filters).toEqual({ since: "1h" });
  });
});

describe("presetMatches", () => {
  it("'all' matches only when no filters are active", () => {
    const all = PRESETS[0];
    expect(presetMatches(all, {})).toBe(true);
    expect(presetMatches(all, { tier: "high" })).toBe(false);
  });

  it("matches when filter shape exactly equals preset shape", () => {
    const blocksToday = PRESETS.find((p) => p.id === "blocks-today")!;
    expect(presetMatches(blocksToday, { decision: "block", since: "24h" })).toBe(true);
  });

  it("does not match when extra filter keys are present", () => {
    const lastHour = PRESETS.find((p) => p.id === "last-hour")!;
    expect(presetMatches(lastHour, { since: "1h", agent: "baddie" })).toBe(false);
  });

  it("does not match when filter keys are missing", () => {
    const blocksToday = PRESETS.find((p) => p.id === "blocks-today")!;
    expect(presetMatches(blocksToday, { decision: "block" })).toBe(false);
  });

  it("treats empty-string values as absent", () => {
    const high = PRESETS.find((p) => p.id === "high-risk-only")!;
    expect(presetMatches(high, { tier: "high", agent: "" })).toBe(true);
  });
});
