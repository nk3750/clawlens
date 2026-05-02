import { describe, expect, it } from "vitest";
import {
  applyFilters,
  computeCounts,
  resourceKindFromTarget,
  shortPath,
} from "../dashboard/src/components/guardrails/shared";
import type { Guardrail } from "../dashboard/src/lib/types";

function rule(o: Partial<Guardrail> & Pick<Guardrail, "id">): Guardrail {
  return {
    id: o.id,
    selector: o.selector ?? { agent: null, tools: { mode: "names", values: ["exec"] } },
    target: o.target ?? { kind: "command-glob", pattern: "rm -rf *" },
    action: o.action ?? "block",
    description: o.description ?? "test",
    createdAt: o.createdAt ?? "2026-04-01T00:00:00.000Z",
    source: o.source ?? { toolCallId: "tc", sessionKey: "sk", agentId: "alpha" },
    riskScore: o.riskScore ?? 50,
    note: o.note,
    hits24h: o.hits24h,
    hits7d: o.hits7d,
    lastFiredAt: o.lastFiredAt,
  };
}

describe("resourceKindFromTarget", () => {
  it("maps every target.kind exhaustively", () => {
    expect(resourceKindFromTarget({ kind: "path-glob", pattern: "/x" })).toBe("file");
    expect(resourceKindFromTarget({ kind: "command-glob", pattern: "x" })).toBe("exec");
    expect(resourceKindFromTarget({ kind: "url-glob", pattern: "x" })).toBe("url");
    expect(resourceKindFromTarget({ kind: "identity-glob", pattern: "x" })).toBe("advanced");
  });
});

describe("applyFilters", () => {
  const rules: Guardrail[] = [
    rule({
      id: "1",
      action: "block",
      selector: { agent: "alpha", tools: { mode: "any" } },
      target: { kind: "path-glob", pattern: "/a" },
      riskScore: 80,
    }),
    rule({
      id: "2",
      action: "require_approval",
      selector: { agent: null, tools: { mode: "any" } },
      target: { kind: "url-glob", pattern: "https://x" },
      riskScore: 40,
    }),
    rule({
      id: "3",
      action: "block",
      selector: { agent: "alpha", tools: { mode: "any" } },
      target: { kind: "identity-glob", pattern: "y" },
      riskScore: 10,
    }),
    rule({
      id: "4",
      action: "allow_notify",
      selector: { agent: "beta", tools: { mode: "any" } },
      target: { kind: "command-glob", pattern: "z" },
      riskScore: 60,
    }),
  ];

  it("returns all rules when filters are empty", () => {
    expect(applyFilters(rules, {})).toHaveLength(4);
  });

  it("filters by specific agent", () => {
    expect(applyFilters(rules, { agent: "alpha" }).map((r) => r.id)).toEqual(["1", "3"]);
  });

  it("filters by global ('global' or null both match selector.agent === null)", () => {
    expect(applyFilters(rules, { agent: "global" }).map((r) => r.id)).toEqual(["2"]);
    expect(applyFilters(rules, { agent: null }).map((r) => r.id)).toEqual(["2"]);
  });

  it("filters by action", () => {
    expect(applyFilters(rules, { action: "block" }).map((r) => r.id)).toEqual(["1", "3"]);
    expect(applyFilters(rules, { action: "require_approval" }).map((r) => r.id)).toEqual(["2"]);
    expect(applyFilters(rules, { action: "allow_notify" }).map((r) => r.id)).toEqual(["4"]);
  });

  it("filters by kind and excludes identity-glob ('advanced') from any kind filter", () => {
    expect(applyFilters(rules, { kind: "file" }).map((r) => r.id)).toEqual(["1"]);
    expect(applyFilters(rules, { kind: "url" }).map((r) => r.id)).toEqual(["2"]);
    expect(applyFilters(rules, { kind: "exec" }).map((r) => r.id)).toEqual(["4"]);
    // identity-glob rule "3" excluded from every kind filter
    expect(applyFilters(rules, { kind: "file" }).find((r) => r.id === "3")).toBeUndefined();
    expect(applyFilters(rules, { kind: "exec" }).find((r) => r.id === "3")).toBeUndefined();
    expect(applyFilters(rules, { kind: "url" }).find((r) => r.id === "3")).toBeUndefined();
  });

  it("filters by tier (riskTierFromScore semantics)", () => {
    expect(applyFilters(rules, { tier: "critical" }).map((r) => r.id)).toEqual(["1"]); // 80 > 75
    expect(applyFilters(rules, { tier: "medium" }).map((r) => r.id)).toEqual(["2"]); // 40
    expect(applyFilters(rules, { tier: "low" }).map((r) => r.id)).toEqual(["3"]); // 10
    expect(applyFilters(rules, { tier: "high" }).map((r) => r.id)).toEqual(["4"]); // 60
  });

  it("composes filters with AND semantics", () => {
    expect(applyFilters(rules, { agent: "alpha", action: "block" }).map((r) => r.id)).toEqual([
      "1",
      "3",
    ]);
    expect(
      applyFilters(rules, { agent: "alpha", action: "block", kind: "file" }).map((r) => r.id),
    ).toEqual(["1"]);
    expect(applyFilters(rules, { agent: "beta", tier: "critical" })).toHaveLength(0);
  });
});

describe("computeCounts", () => {
  const rules: Guardrail[] = [
    rule({
      id: "1",
      action: "block",
      selector: { agent: "alpha", tools: { mode: "any" } },
      target: { kind: "path-glob", pattern: "/a" },
      riskScore: 80,
    }),
    rule({
      id: "2",
      action: "require_approval",
      selector: { agent: null, tools: { mode: "any" } },
      target: { kind: "url-glob", pattern: "x" },
      riskScore: 40,
    }),
    rule({
      id: "3",
      action: "block",
      selector: { agent: "alpha", tools: { mode: "any" } },
      target: { kind: "identity-glob", pattern: "y" },
      riskScore: 10,
    }),
  ];

  it("counts agents with 'global' for selector.agent === null", () => {
    const c = computeCounts(rules);
    expect(c.agent.alpha).toBe(2);
    expect(c.agent.global).toBe(1);
  });

  it("counts every action exhaustively", () => {
    const c = computeCounts(rules);
    expect(c.action.block).toBe(2);
    expect(c.action.require_approval).toBe(1);
    expect(c.action.allow_notify).toBe(0);
  });

  it("counts every kind including 'advanced' for identity-glob", () => {
    const c = computeCounts(rules);
    expect(c.kind.file).toBe(1);
    expect(c.kind.url).toBe(1);
    expect(c.kind.advanced).toBe(1);
    expect(c.kind.exec).toBe(0);
  });

  it("counts every tier exhaustively", () => {
    const c = computeCounts(rules);
    expect(c.tier.critical).toBe(1);
    expect(c.tier.medium).toBe(1);
    expect(c.tier.low).toBe(1);
    expect(c.tier.high).toBe(0);
  });

  it("returns all-zero counts for an empty rule set", () => {
    const c = computeCounts([]);
    expect(c.action.block).toBe(0);
    expect(c.kind.file).toBe(0);
    expect(c.tier.low).toBe(0);
  });
});

describe("shortPath", () => {
  it("returns the input unchanged when shorter than max", () => {
    expect(shortPath("/foo/bar", 30)).toBe("/foo/bar");
    expect(shortPath("", 10)).toBe("");
  });

  it("truncates from the middle and preserves both ends", () => {
    const out = shortPath("/Users/me/code/project/src/components/foo.txt", 20);
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out.startsWith("/")).toBe(true);
    expect(out.endsWith("foo.txt")).toBe(true);
    expect(out).toContain("…"); // …
  });

  it("preserves last few characters even at very small max", () => {
    const out = shortPath("/very/long/path/to/file.ts", 8);
    expect(out).toContain("…");
  });
});
