import { describe, expect, it } from "vitest";
import {
  ACTION_META,
  applyFilters,
  computeCounts,
  resourceKindFromTarget,
  resourceKindFromToolName,
  shortPath,
  suggestGlobs,
  targetKindFor,
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

// ── Phase 2.5 helpers ───────────────────────────────────

describe("suggestGlobs — file kind", () => {
  it("dotfile under a directory yields ext + dir + dotfile carve-out", () => {
    expect(suggestGlobs("file", "/Users/op/work/.env")).toEqual([
      "**/*.env",
      "/Users/op/work/*.env",
      "**/.env",
    ]);
  });

  it("no-extension absolute path falls back to dir + literal-wildcard", () => {
    expect(suggestGlobs("file", "/etc/passwd")).toEqual(["/etc/*", "/etc/passwd*"]);
  });

  it("bare filename yields ext-broadener + literal-wildcard", () => {
    expect(suggestGlobs("file", "README.md")).toEqual(["**/*.md", "README.md*"]);
  });

  it("returns at most 3 candidates", () => {
    const out = suggestGlobs("file", "/Users/op/work/.env");
    expect(out.length).toBeLessThanOrEqual(3);
  });
});

describe("suggestGlobs — exec kind", () => {
  it("head + leading flag yields head-glob, head-flag-glob, head-prefix-glob", () => {
    expect(suggestGlobs("exec", "rm -rf /tmp/foo")).toEqual(["rm *", "rm -rf *", "rm*"]);
  });

  it("flag deep in argv is detected and preserved (positional before flag)", () => {
    expect(suggestGlobs("exec", "git push --force")).toEqual(["git *", "git --force *", "git*"]);
  });

  it("single-token command yields head-glob + head-prefix-glob (no flag)", () => {
    expect(suggestGlobs("exec", "bash")).toEqual(["bash *", "bash*"]);
  });
});

describe("suggestGlobs — url kind", () => {
  it("parseable URL yields origin/**, origin/firstSegment/**, protocol-agnostic", () => {
    expect(suggestGlobs("url", "https://api.openai.com/v1/chat/completions")).toEqual([
      "https://api.openai.com/**",
      "https://api.openai.com/v1/**",
      "*://api.openai.com/**",
    ]);
  });

  it("URL without a path segment skips the firstSegment candidate", () => {
    const out = suggestGlobs("url", "https://example.com/");
    expect(out).toContain("https://example.com/**");
    expect(out).toContain("*://example.com/**");
    expect(out.every((s) => !s.includes("/undefined/"))).toBe(true);
  });

  it("malformed URL falls back to literal-wildcard", () => {
    expect(suggestGlobs("url", "not-a-valid-url")).toEqual(["not-a-valid-url*"]);
  });
});

describe("suggestGlobs — fallbacks", () => {
  it("advanced kind always returns []", () => {
    expect(suggestGlobs("advanced", "anything")).toEqual([]);
    expect(suggestGlobs("advanced", "")).toEqual([]);
  });

  it("empty exact returns [] for every kind", () => {
    expect(suggestGlobs("file", "")).toEqual([]);
    expect(suggestGlobs("exec", "")).toEqual([]);
    expect(suggestGlobs("url", "")).toEqual([]);
  });
});

describe("targetKindFor", () => {
  it("maps file → path-glob, exec → command-glob, url → url-glob", () => {
    expect(targetKindFor("file")).toBe("path-glob");
    expect(targetKindFor("exec")).toBe("command-glob");
    expect(targetKindFor("url")).toBe("url-glob");
  });
});

describe("resourceKindFromToolName", () => {
  it("returns 'file' for any verb in VERB_LIBRARY.file", () => {
    expect(resourceKindFromToolName("read")).toBe("file");
    expect(resourceKindFromToolName("write")).toBe("file");
    expect(resourceKindFromToolName("edit")).toBe("file");
    expect(resourceKindFromToolName("apply_patch")).toBe("file");
  });

  it("returns 'exec' for 'exec'", () => {
    expect(resourceKindFromToolName("exec")).toBe("exec");
  });

  it("returns 'url' for any URL verb", () => {
    expect(resourceKindFromToolName("web_fetch")).toBe("url");
    expect(resourceKindFromToolName("fetch_url")).toBe("url");
    expect(resourceKindFromToolName("browser")).toBe("url");
  });

  it("returns 'advanced' for unknown / MCP tool names", () => {
    expect(resourceKindFromToolName("linear_create_ticket")).toBe("advanced");
    expect(resourceKindFromToolName("slack_post_message")).toBe("advanced");
    expect(resourceKindFromToolName("")).toBe("advanced");
  });
});

describe("ACTION_META.blurb", () => {
  it("each action has a one-sentence blurb", () => {
    expect(ACTION_META.block.blurb).toBe("Calls never reach the tool.");
    expect(ACTION_META.require_approval.blurb).toBe("Pause and notify; you decide.");
    expect(ACTION_META.allow_notify.blurb).toBe("Pass through, audit on the side.");
  });

  it("preserves existing label / mono / color fields", () => {
    expect(ACTION_META.block.label).toBe("Block");
    expect(ACTION_META.block.mono).toBe("BLOCK");
    expect(ACTION_META.block.color).toBe("var(--cl-risk-high)");
    expect(ACTION_META.require_approval.label).toBe("Require Approval");
    expect(ACTION_META.allow_notify.color).toBe("var(--cl-info)");
  });
});
