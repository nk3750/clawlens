import { describe, expect, it } from "vitest";
import {
  type Guardrail,
  isValidAction,
  isValidGuardrail,
  isValidSelector,
  isValidTarget,
} from "../src/guardrails/types";

// Anchors for the "valid" shape used across negative tests below. Every
// rejection test mutates exactly one field so a regression localizes cleanly
// to the field at fault.
const validRule: Guardrail = {
  id: "gr_abc123",
  selector: { agent: null, tools: { mode: "any" } },
  target: { kind: "path-glob", pattern: "/etc/**" },
  action: "block",
  description: "Block any tool path matching '/etc/**'",
  createdAt: "2026-05-01T00:00:00Z",
  source: { toolCallId: "tc_x", sessionKey: "sess_x", agentId: "alpha" },
  riskScore: 50,
};

describe("isValidAction (flat string union)", () => {
  it("accepts block", () => {
    expect(isValidAction("block")).toBe(true);
  });
  it("accepts require_approval", () => {
    expect(isValidAction("require_approval")).toBe(true);
  });
  it("accepts allow_notify", () => {
    expect(isValidAction("allow_notify")).toBe(true);
  });
  it("rejects unknown string", () => {
    expect(isValidAction("delete")).toBe(false);
  });
  it("rejects legacy object form", () => {
    expect(isValidAction({ type: "block" })).toBe(false);
  });
  it("rejects empty string", () => {
    expect(isValidAction("")).toBe(false);
  });
  it("rejects null", () => {
    expect(isValidAction(null)).toBe(false);
  });
  it("rejects undefined", () => {
    expect(isValidAction(undefined)).toBe(false);
  });
  it("rejects number", () => {
    expect(isValidAction(0)).toBe(false);
  });
});

describe("isValidSelector", () => {
  it("accepts mode=any with agent=null", () => {
    expect(isValidSelector({ agent: null, tools: { mode: "any" } })).toBe(true);
  });
  it("accepts mode=any with agent=string", () => {
    expect(isValidSelector({ agent: "agent-1", tools: { mode: "any" } })).toBe(true);
  });
  it("accepts mode=names with at least one value", () => {
    expect(isValidSelector({ agent: null, tools: { mode: "names", values: ["write"] } })).toBe(
      true,
    );
  });
  it("accepts mode=names with multiple values", () => {
    expect(
      isValidSelector({
        agent: null,
        tools: { mode: "names", values: ["write", "edit", "apply_patch"] },
      }),
    ).toBe(true);
  });
  it("rejects mode=names with empty array", () => {
    expect(isValidSelector({ agent: null, tools: { mode: "names", values: [] } })).toBe(false);
  });
  it("rejects mode=names with non-string entry", () => {
    expect(
      isValidSelector({ agent: null, tools: { mode: "names", values: [42] } } as unknown),
    ).toBe(false);
  });
  it("rejects mode=names with empty-string entry", () => {
    expect(isValidSelector({ agent: null, tools: { mode: "names", values: [""] } })).toBe(false);
  });
  it("accepts each ActivityCategory in mode=category", () => {
    for (const c of [
      "exploring",
      "changes",
      "git",
      "scripts",
      "web",
      "comms",
      "orchestration",
      "media",
    ]) {
      expect(isValidSelector({ agent: null, tools: { mode: "category", value: c } })).toBe(true);
    }
  });
  it("rejects mode=category with unknown category", () => {
    expect(
      isValidSelector({ agent: null, tools: { mode: "category", value: "rabbits" } } as unknown),
    ).toBe(false);
  });
  it("rejects mode=category missing value", () => {
    expect(isValidSelector({ agent: null, tools: { mode: "category" } } as unknown)).toBe(false);
  });
  it("rejects unknown tools.mode", () => {
    expect(isValidSelector({ agent: null, tools: { mode: "regex" } } as unknown)).toBe(false);
  });
  it("rejects missing tools entirely", () => {
    expect(isValidSelector({ agent: null } as unknown)).toBe(false);
  });
  it("rejects non-null non-string agent", () => {
    expect(isValidSelector({ agent: 42, tools: { mode: "any" } } as unknown)).toBe(false);
  });
  it("rejects null", () => {
    expect(isValidSelector(null)).toBe(false);
  });
});

describe("isValidTarget", () => {
  for (const kind of ["path-glob", "url-glob", "command-glob", "identity-glob"] as const) {
    it(`accepts ${kind} with a non-empty pattern`, () => {
      expect(isValidTarget({ kind, pattern: "x" })).toBe(true);
    });
    it(`rejects ${kind} with empty-string pattern`, () => {
      expect(isValidTarget({ kind, pattern: "" })).toBe(false);
    });
    it(`rejects ${kind} with non-string pattern`, () => {
      expect(isValidTarget({ kind, pattern: 42 } as unknown)).toBe(false);
    });
  }
  it("rejects unknown target.kind", () => {
    expect(isValidTarget({ kind: "regex", pattern: "x" } as unknown)).toBe(false);
  });
  it("rejects missing kind", () => {
    expect(isValidTarget({ pattern: "x" } as unknown)).toBe(false);
  });
  it("rejects null", () => {
    expect(isValidTarget(null)).toBe(false);
  });
});

describe("isValidGuardrail (full shape)", () => {
  it("accepts a fully-formed rule", () => {
    expect(isValidGuardrail(validRule)).toBe(true);
  });
  it("accepts a rule with optional note", () => {
    expect(isValidGuardrail({ ...validRule, note: "watching this" })).toBe(true);
  });
  it("rejects rule with non-string note", () => {
    expect(isValidGuardrail({ ...validRule, note: 42 })).toBe(false);
  });
  it("rejects rule with empty-string id", () => {
    expect(isValidGuardrail({ ...validRule, id: "" })).toBe(false);
  });
  it("rejects rule missing id", () => {
    const { id: _id, ...rest } = validRule;
    expect(isValidGuardrail(rest)).toBe(false);
  });
  it("rejects rule missing selector", () => {
    const { selector: _s, ...rest } = validRule;
    expect(isValidGuardrail(rest)).toBe(false);
  });
  it("rejects rule missing target", () => {
    const { target: _t, ...rest } = validRule;
    expect(isValidGuardrail(rest)).toBe(false);
  });
  it("rejects rule missing action", () => {
    const { action: _a, ...rest } = validRule;
    expect(isValidGuardrail(rest)).toBe(false);
  });
  it("rejects rule missing description", () => {
    const { description: _d, ...rest } = validRule;
    expect(isValidGuardrail(rest)).toBe(false);
  });
  it("rejects rule missing createdAt", () => {
    const { createdAt: _c, ...rest } = validRule;
    expect(isValidGuardrail(rest)).toBe(false);
  });
  it("rejects rule missing source", () => {
    const { source: _s, ...rest } = validRule;
    expect(isValidGuardrail(rest)).toBe(false);
  });
  it("rejects rule with malformed source (non-string toolCallId)", () => {
    expect(
      isValidGuardrail({
        ...validRule,
        source: { toolCallId: 0 as unknown as string, sessionKey: "x", agentId: "y" },
      }),
    ).toBe(false);
  });
  it("rejects rule with non-number riskScore", () => {
    expect(isValidGuardrail({ ...validRule, riskScore: "high" })).toBe(false);
  });
  it("rejects rule with object-form action (legacy schema)", () => {
    expect(isValidGuardrail({ ...validRule, action: { type: "block" } })).toBe(false);
  });
  it("rejects rule with empty target pattern", () => {
    expect(isValidGuardrail({ ...validRule, target: { kind: "path-glob", pattern: "" } })).toBe(
      false,
    );
  });
  it("rejects rule with empty tools.values", () => {
    expect(
      isValidGuardrail({
        ...validRule,
        selector: { agent: null, tools: { mode: "names", values: [] } },
      }),
    ).toBe(false);
  });
  it("rejects rule with unknown ActivityCategory", () => {
    expect(
      isValidGuardrail({
        ...validRule,
        selector: { agent: null, tools: { mode: "category", value: "ducks" } as unknown },
      } as unknown),
    ).toBe(false);
  });
  it("rejects null", () => {
    expect(isValidGuardrail(null)).toBe(false);
  });
  it("rejects bare object", () => {
    expect(isValidGuardrail({})).toBe(false);
  });
});
