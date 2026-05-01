import { describe, expect, it } from "vitest";
import { describeRule } from "../src/dashboard/categories";
import type { NewGuardrail } from "../src/guardrails/types";

const baseSource: NewGuardrail["source"] = {
  toolCallId: "tc_x",
  sessionKey: "sess_x",
  agentId: "alpha",
};

function rule(overrides: Partial<NewGuardrail>): NewGuardrail {
  return {
    selector: { agent: null, tools: { mode: "any" } },
    target: { kind: "path-glob", pattern: "/x" },
    action: "block",
    source: baseSource,
    riskScore: 0,
    ...overrides,
  };
}

describe("describeRule — verbs (one per Action)", () => {
  it("Block for action=block", () => {
    expect(describeRule(rule({ action: "block" }))).toMatch(/^Block /);
  });
  it("Require approval for action=require_approval", () => {
    expect(describeRule(rule({ action: "require_approval" }))).toMatch(/^Require approval for /);
  });
  it("Notify on for action=allow_notify", () => {
    expect(describeRule(rule({ action: "allow_notify" }))).toMatch(/^Notify on /);
  });
});

describe("describeRule — tools clause (one per ToolSelector mode)", () => {
  it("any-mode reads as 'any tool'", () => {
    expect(describeRule(rule({ selector: { agent: null, tools: { mode: "any" } } }))).toContain(
      "any tool",
    );
  });
  it("category-mode reads as '<category> category'", () => {
    expect(
      describeRule(
        rule({ selector: { agent: null, tools: { mode: "category", value: "scripts" } } }),
      ),
    ).toContain("scripts category");
  });
  it("names-mode with one value reads as '<tool> tool'", () => {
    expect(
      describeRule(rule({ selector: { agent: null, tools: { mode: "names", values: ["exec"] } } })),
    ).toContain("exec tool");
  });
  it("names-mode with multi values is sorted, '/'-joined, suffixed 'tools'", () => {
    const out = describeRule(
      rule({
        selector: {
          agent: null,
          tools: { mode: "names", values: ["write", "edit", "apply_patch"] },
        },
      }),
    );
    expect(out).toContain("apply_patch/edit/write tools");
  });
  it("does not mutate the caller's tools.values array", () => {
    const original = ["b", "a"];
    describeRule(rule({ selector: { agent: null, tools: { mode: "names", values: original } } }));
    expect(original).toEqual(["b", "a"]);
  });
});

describe("describeRule — target clause (one per Target.kind)", () => {
  it("path-glob reads 'path matching '<pattern>''", () => {
    expect(describeRule(rule({ target: { kind: "path-glob", pattern: "/etc/**" } }))).toContain(
      "path matching '/etc/**'",
    );
  });
  it("url-glob reads 'URL matching '<pattern>''", () => {
    expect(
      describeRule(rule({ target: { kind: "url-glob", pattern: "*://apnews.com/**" } })),
    ).toContain("URL matching '*://apnews.com/**'");
  });
  it("command-glob reads 'command matching '<pattern>''", () => {
    expect(
      describeRule(rule({ target: { kind: "command-glob", pattern: "* --force *" } })),
    ).toContain("command matching '* --force *'");
  });
  it("identity-glob reads 'identity matching '<pattern>''", () => {
    expect(describeRule(rule({ target: { kind: "identity-glob", pattern: "poll:*" } }))).toContain(
      "identity matching 'poll:*'",
    );
  });
});

describe("describeRule — agent suffix", () => {
  it("omits suffix when agent is null", () => {
    const out = describeRule(rule({ selector: { agent: null, tools: { mode: "any" } } }));
    expect(out).not.toContain("for agent");
  });
  it("appends ' for agent <id>' when agent is set", () => {
    const out = describeRule(rule({ selector: { agent: "baddie", tools: { mode: "any" } } }));
    expect(out).toMatch(/for agent baddie$/);
  });
});

// Renderings of the §4.2 examples — fixed strings so any rephrase shows up
// as a regression instead of silently shifting copy.
describe("describeRule — full renderings (spec §4.5)", () => {
  it("rule 1: Block exec tool identity matching 'rm -rf node_modules'", () => {
    expect(
      describeRule(
        rule({
          selector: { agent: null, tools: { mode: "names", values: ["exec"] } },
          target: { kind: "identity-glob", pattern: "rm -rf node_modules" },
          action: "block",
        }),
      ),
    ).toBe("Block exec tool identity matching 'rm -rf node_modules'");
  });
  it("rule 2: Require approval for apply_patch/edit/write tools path matching '…' for agent baddie", () => {
    expect(
      describeRule(
        rule({
          selector: {
            agent: "baddie",
            tools: { mode: "names", values: ["write", "edit", "apply_patch"] },
          },
          target: { kind: "path-glob", pattern: "/Users/**/secrets/**" },
          action: "require_approval",
        }),
      ),
    ).toBe(
      "Require approval for apply_patch/edit/write tools path matching '/Users/**/secrets/**' for agent baddie",
    );
  });
  it("rule 3: Block scripts category command matching '* --force *'", () => {
    expect(
      describeRule(
        rule({
          selector: { agent: null, tools: { mode: "category", value: "scripts" } },
          target: { kind: "command-glob", pattern: "* --force *" },
          action: "block",
        }),
      ),
    ).toBe("Block scripts category command matching '* --force *'");
  });
  it("rule 4: Require approval for any tool URL matching '*://apnews.com/**'", () => {
    expect(
      describeRule(
        rule({
          selector: { agent: null, tools: { mode: "any" } },
          target: { kind: "url-glob", pattern: "*://apnews.com/**" },
          action: "require_approval",
        }),
      ),
    ).toBe("Require approval for any tool URL matching '*://apnews.com/**'");
  });
  it("rule 5: Block process tool identity matching 'poll:*'", () => {
    expect(
      describeRule(
        rule({
          selector: { agent: null, tools: { mode: "names", values: ["process"] } },
          target: { kind: "identity-glob", pattern: "poll:*" },
          action: "block",
        }),
      ),
    ).toBe("Block process tool identity matching 'poll:*'");
  });
  it("rule 6: Require approval for message tool identity matching 'send:#alerts*' for agent social-manager", () => {
    expect(
      describeRule(
        rule({
          selector: { agent: "social-manager", tools: { mode: "names", values: ["message"] } },
          target: { kind: "identity-glob", pattern: "send:#alerts*" },
          action: "require_approval",
        }),
      ),
    ).toBe(
      "Require approval for message tool identity matching 'send:#alerts*' for agent social-manager",
    );
  });
  it("rule 7: Notify on browser/fetch_url/web_fetch tools URL matching '…' for agent social-manager", () => {
    expect(
      describeRule(
        rule({
          selector: {
            agent: "social-manager",
            tools: { mode: "names", values: ["web_fetch", "fetch_url", "browser"] },
          },
          target: { kind: "url-glob", pattern: "*://*.REDACTED.ts.net/**" },
          action: "allow_notify",
        }),
      ),
    ).toBe(
      "Notify on browser/fetch_url/web_fetch tools URL matching '*://*.REDACTED.ts.net/**' for agent social-manager",
    );
  });
});
