import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock identity.ts so the memoization test can assert call counts. The spy
// delegates to the real implementation so behavior is unchanged for every
// other test in this file.
vi.mock("../src/guardrails/identity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/guardrails/identity")>();
  return {
    ...actual,
    extractIdentityKey: vi.fn(actual.extractIdentityKey),
  };
});

import * as identity from "../src/guardrails/identity";
import { GuardrailStore } from "../src/guardrails/store";
import type { Action, Guardrail, NewGuardrail, Selector, Target } from "../src/guardrails/types";

let counter = 0;
function nextId(): string {
  counter++;
  return `gr_t${counter.toString().padStart(6, "0")}`;
}

// Build a fully-formed Guardrail with sensible defaults. Tests override only
// the fields they care about — keeps each case readable next to its intent.
function mk(
  opts: Partial<Guardrail> & Partial<{ selector: Selector; target: Target; action: Action }>,
): Guardrail {
  return {
    id: opts.id ?? nextId(),
    selector: opts.selector ?? { agent: null, tools: { mode: "any" } },
    // `**` matches every identity key (including those with slashes / colons)
    // so selector-dimension tests don't accidentally fail on the target check.
    // Tests that exercise the target check override this explicitly.
    target: opts.target ?? { kind: "identity-glob", pattern: "**" },
    action: opts.action ?? "block",
    description: opts.description ?? "test rule",
    createdAt: opts.createdAt ?? new Date(2026, 0, 1).toISOString(),
    source: opts.source ?? { toolCallId: "tc_x", sessionKey: "sess_x", agentId: "alpha" },
    riskScore: opts.riskScore ?? 0,
    note: opts.note,
  };
}

let tmpDir: string;
let store: GuardrailStore;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawlens-match-"));
  const file = path.join(tmpDir, "guardrails.json");
  store = new GuardrailStore(file);
  store.load();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── selector.agent ────────────────────────────────────────────

describe("matchesSelector — agent dimension", () => {
  it("agent=null matches any agent id", () => {
    store.add(mk({ selector: { agent: null, tools: { mode: "any" } } }));
    expect(store.match("alpha", "exec", { command: "x" })).not.toBeNull();
    expect(store.match("beta", "exec", { command: "x" })).not.toBeNull();
  });
  it("agent=string matches that agent only", () => {
    store.add(mk({ selector: { agent: "alpha", tools: { mode: "any" } } }));
    expect(store.match("alpha", "exec", { command: "x" })).not.toBeNull();
    expect(store.match("beta", "exec", { command: "x" })).toBeNull();
  });
});

// ── selector.tools.mode (3 variants) ──────────────────────────

describe("matchesSelector — tools.mode dimension", () => {
  it("mode=any matches every tool", () => {
    store.add(mk({ selector: { agent: null, tools: { mode: "any" } } }));
    expect(store.match("alpha", "read", { path: "/x" })).not.toBeNull();
    expect(store.match("alpha", "write", { path: "/x" })).not.toBeNull();
    expect(store.match("alpha", "exec", { command: "y" })).not.toBeNull();
  });
  it("mode=names matches only listed tools", () => {
    store.add(
      mk({ selector: { agent: null, tools: { mode: "names", values: ["write", "edit"] } } }),
    );
    expect(store.match("alpha", "write", { path: "/x" })).not.toBeNull();
    expect(store.match("alpha", "edit", { path: "/x" })).not.toBeNull();
    expect(store.match("alpha", "read", { path: "/x" })).toBeNull();
    expect(store.match("alpha", "exec", { command: "x" })).toBeNull();
  });
  it("mode=category matches tools whose ActivityCategory is the value (changes)", () => {
    store.add(mk({ selector: { agent: null, tools: { mode: "category", value: "changes" } } }));
    expect(store.match("alpha", "write", { path: "/x" })).not.toBeNull();
    expect(store.match("alpha", "edit", { path: "/x" })).not.toBeNull();
    expect(store.match("alpha", "apply_patch", { patch: "*** Update File: /a" })).not.toBeNull();
    expect(store.match("alpha", "read", { path: "/x" })).toBeNull();
  });
  it("mode=category routes exec via its sub-category (network-write → web)", () => {
    store.add(mk({ selector: { agent: null, tools: { mode: "category", value: "web" } } }));
    expect(store.match("alpha", "exec", { command: "curl https://x" })).not.toBeNull();
    expect(store.match("alpha", "exec", { command: "ls -la" })).toBeNull();
  });
  it("mode=category exhaustively matches comms tools", () => {
    store.add(mk({ selector: { agent: null, tools: { mode: "category", value: "comms" } } }));
    expect(store.match("alpha", "message", { action: "send", target: "#chan" })).not.toBeNull();
    expect(store.match("alpha", "read", { path: "/x" })).toBeNull();
  });
});

// ── target.kind: path-glob ────────────────────────────────────

describe("matchesTarget — path-glob", () => {
  it("matches a write to /etc/secrets/* via /etc/**", () => {
    store.add(
      mk({
        selector: { agent: null, tools: { mode: "any" } },
        target: { kind: "path-glob", pattern: "/etc/**" },
      }),
    );
    expect(store.match("alpha", "write", { path: "/etc/secrets/foo" })).not.toBeNull();
  });
  it("matches read with the same target", () => {
    store.add(
      mk({
        selector: { agent: null, tools: { mode: "any" } },
        target: { kind: "path-glob", pattern: "/etc/**" },
      }),
    );
    expect(store.match("alpha", "read", { path: "/etc/passwd" })).not.toBeNull();
  });
  it("does not match a path outside the glob", () => {
    store.add(
      mk({
        selector: { agent: null, tools: { mode: "any" } },
        target: { kind: "path-glob", pattern: "/etc/**" },
      }),
    );
    expect(store.match("alpha", "write", { path: "/tmp/scratch" })).toBeNull();
  });
  it("does not match a tool with no extractable path (exec)", () => {
    store.add(
      mk({
        selector: { agent: null, tools: { mode: "any" } },
        target: { kind: "path-glob", pattern: "/etc/**" },
      }),
    );
    expect(store.match("alpha", "exec", { command: "rm /etc/passwd" })).toBeNull();
  });
  it("matches an apply_patch touching a path inside the glob (Gap 3)", () => {
    store.add(
      mk({
        selector: { agent: null, tools: { mode: "any" } },
        target: { kind: "path-glob", pattern: "/etc/secrets/**" },
      }),
    );
    const patch = "*** Update File: /etc/secrets/keys\n@@\n-old\n+new\n";
    expect(store.match("alpha", "apply_patch", { patch })).not.toBeNull();
  });
  it("matches a multi-file apply_patch where ANY path is inside the glob", () => {
    store.add(
      mk({
        selector: { agent: null, tools: { mode: "any" } },
        target: { kind: "path-glob", pattern: "/etc/secrets/**" },
      }),
    );
    const patch = `--- a/etc/secrets/foo
+++ b/etc/secrets/foo
@@ -1 +1 @@
-x
+y
--- a/tmp/scratch
+++ b/tmp/scratch
@@ -1 +1 @@
-x
+y`;
    // Note: unified-diff captures `etc/secrets/foo` (no leading slash).
    // Use a relative-rooted glob to match — the operator picks the form.
    store.add(
      mk({
        selector: { agent: null, tools: { mode: "any" } },
        target: { kind: "path-glob", pattern: "etc/secrets/**" },
      }),
    );
    expect(store.match("alpha", "apply_patch", { patch })).not.toBeNull();
  });
  it("does NOT match a multi-file apply_patch where NO path is inside the glob", () => {
    store.add(
      mk({
        selector: { agent: null, tools: { mode: "any" } },
        target: { kind: "path-glob", pattern: "etc/secrets/**" },
      }),
    );
    const patch = `--- a/tmp/scratch
+++ b/tmp/scratch
@@ -1 +1 @@
-x
+y`;
    expect(store.match("alpha", "apply_patch", { patch })).toBeNull();
  });
  it("does NOT match a malformed apply_patch (regression: never auto-match-on-empty)", () => {
    store.add(
      mk({
        selector: { agent: null, tools: { mode: "any" } },
        target: { kind: "path-glob", pattern: "/etc/**" },
      }),
    );
    expect(store.match("alpha", "apply_patch", { patch: "garbage" })).toBeNull();
    expect(store.match("alpha", "apply_patch", { patch: "" })).toBeNull();
    expect(store.match("alpha", "apply_patch", {})).toBeNull();
  });
});

// ── target.kind: url-glob ─────────────────────────────────────

describe("matchesTarget — url-glob", () => {
  it("matches a web_fetch URL", () => {
    store.add(
      mk({
        selector: { agent: null, tools: { mode: "any" } },
        target: { kind: "url-glob", pattern: "*://apnews.com/**" },
      }),
    );
    expect(store.match("alpha", "web_fetch", { url: "https://apnews.com/hub/x" })).not.toBeNull();
  });
  it("matches an exec curl URL — closes Gap 1 (cross-tool bypass)", () => {
    store.add(
      mk({
        selector: { agent: null, tools: { mode: "any" } },
        target: { kind: "url-glob", pattern: "*://apnews.com/**" },
      }),
    );
    expect(
      store.match("alpha", "exec", { command: "curl https://apnews.com/breaking" }),
    ).not.toBeNull();
  });
  it("matches a multi-URL exec command (Gap 1 multi-URL)", () => {
    store.add(
      mk({
        selector: { agent: null, tools: { mode: "any" } },
        target: { kind: "url-glob", pattern: "*://b.com/**" },
      }),
    );
    expect(
      store.match("alpha", "exec", { command: "curl https://a.com/x && wget https://b.com/y" }),
    ).not.toBeNull();
  });
  it("matches a sub-path that the bare-host pattern would also catch (Gap 2)", () => {
    store.add(
      mk({
        selector: { agent: null, tools: { mode: "any" } },
        target: { kind: "url-glob", pattern: "*://apnews.com/hub/**" },
      }),
    );
    expect(
      store.match("alpha", "web_fetch", { url: "https://apnews.com/hub/trending" }),
    ).not.toBeNull();
    expect(store.match("alpha", "web_fetch", { url: "https://apnews.com" })).toBeNull();
  });
  it("matches browser url", () => {
    store.add(
      mk({
        selector: { agent: null, tools: { mode: "any" } },
        target: { kind: "url-glob", pattern: "*://app.com/**" },
      }),
    );
    expect(
      store.match("alpha", "browser", { action: "click", url: "https://app.com/login" }),
    ).not.toBeNull();
  });
  it("does not match a tool with no URL (read/write)", () => {
    store.add(
      mk({
        selector: { agent: null, tools: { mode: "any" } },
        target: { kind: "url-glob", pattern: "*://apnews.com/**" },
      }),
    );
    expect(store.match("alpha", "read", { path: "/etc/passwd" })).toBeNull();
    expect(store.match("alpha", "write", { path: "/etc/passwd" })).toBeNull();
  });
});

// ── target.kind: command-glob ─────────────────────────────────

describe("matchesTarget — command-glob", () => {
  it("matches an exec command via its glob", () => {
    store.add(
      mk({
        selector: { agent: null, tools: { mode: "any" } },
        target: { kind: "command-glob", pattern: "*--force*" },
      }),
    );
    expect(store.match("alpha", "exec", { command: "npm install --force lodash" })).not.toBeNull();
  });
  it("does not match exec commands that don't fit the glob", () => {
    store.add(
      mk({
        selector: { agent: null, tools: { mode: "any" } },
        target: { kind: "command-glob", pattern: "rm -rf*" },
      }),
    );
    expect(store.match("alpha", "exec", { command: "ls -la" })).toBeNull();
  });
  it("does not match non-exec tools", () => {
    store.add(
      mk({
        selector: { agent: null, tools: { mode: "any" } },
        target: { kind: "command-glob", pattern: "rm -rf*" },
      }),
    );
    expect(store.match("alpha", "read", { path: "/x" })).toBeNull();
    expect(store.match("alpha", "web_fetch", { url: "https://x" })).toBeNull();
  });
});

// ── target.kind: identity-glob ────────────────────────────────

describe("matchesTarget — identity-glob (glob pattern)", () => {
  it("matches all process polls regardless of session via 'poll:*'", () => {
    store.add(
      mk({
        selector: { agent: null, tools: { mode: "names", values: ["process"] } },
        target: { kind: "identity-glob", pattern: "poll:*" },
      }),
    );
    expect(store.match("alpha", "process", { action: "poll", sessionId: "s_a" })).not.toBeNull();
    expect(store.match("alpha", "process", { action: "poll", sessionId: "s_b" })).not.toBeNull();
    expect(store.match("alpha", "process", { action: "kill", sessionId: "s_a" })).toBeNull();
  });
  it("matches message sends to channel-prefix via 'send:#alerts*'", () => {
    store.add(
      mk({
        selector: { agent: null, tools: { mode: "names", values: ["message"] } },
        target: { kind: "identity-glob", pattern: "send:#alerts*" },
      }),
    );
    expect(
      store.match("alpha", "message", { action: "send", target: "#alerts-prod" }),
    ).not.toBeNull();
    expect(store.match("alpha", "message", { action: "send", target: "#general" })).toBeNull();
  });
});

describe("matchesTarget — identity-glob (literal pattern, fast-path)", () => {
  it("matches via direct string equality (literal pattern)", () => {
    store.add(
      mk({
        selector: { agent: null, tools: { mode: "names", values: ["exec"] } },
        target: { kind: "identity-glob", pattern: "rm -rf node_modules" },
      }),
    );
    expect(store.match("alpha", "exec", { command: "rm -rf node_modules" })).not.toBeNull();
    expect(store.match("alpha", "exec", { command: "rm -rf /tmp" })).toBeNull();
  });
  it("matches a normalized command identity (post-normalizeCommand) under literal pattern", () => {
    store.add(
      mk({
        selector: { agent: null, tools: { mode: "names", values: ["exec"] } },
        target: { kind: "identity-glob", pattern: "rm -rf node_modules" },
      }),
    );
    // sudo prefix gets stripped by normalizeCommand → identity key matches.
    expect(store.match("alpha", "exec", { command: "sudo rm -rf node_modules" })).not.toBeNull();
  });
});

// ── First-match-wins, strict insertion order (§5.5) ───────────

describe("strict insertion order — no implicit precedence", () => {
  it("first rule added wins on overlap (broader-glob-then-literal: glob fires first)", () => {
    // `rm *` glob matches `rm node_modules` (no slash in the input). The
    // literal `rm node_modules` rule could ALSO match. First-added wins.
    store.add(
      mk({
        id: "gr_glob_first",
        selector: { agent: null, tools: { mode: "names", values: ["exec"] } },
        target: { kind: "identity-glob", pattern: "rm *" },
        action: "block",
      }),
    );
    store.add(
      mk({
        id: "gr_literal_second",
        selector: { agent: null, tools: { mode: "names", values: ["exec"] } },
        target: { kind: "identity-glob", pattern: "rm node_modules" },
        action: "allow_notify",
      }),
    );
    const matched = store.match("alpha", "exec", { command: "rm node_modules" });
    expect(matched?.id).toBe("gr_glob_first");
    expect(matched?.action).toBe("block");
  });
  it("reverse insertion: literal first, glob second → literal fires (because added first, NOT because literal)", () => {
    store.add(
      mk({
        id: "gr_literal_first",
        selector: { agent: null, tools: { mode: "names", values: ["exec"] } },
        target: { kind: "identity-glob", pattern: "rm node_modules" },
        action: "allow_notify",
      }),
    );
    store.add(
      mk({
        id: "gr_glob_second",
        selector: { agent: null, tools: { mode: "names", values: ["exec"] } },
        target: { kind: "identity-glob", pattern: "rm *" },
        action: "block",
      }),
    );
    const matched = store.match("alpha", "exec", { command: "rm node_modules" });
    expect(matched?.id).toBe("gr_literal_first");
  });
  it("global-first then agent-specific: global fires (regression against agent-specific precedence)", () => {
    store.add(
      mk({
        id: "gr_global_first",
        selector: { agent: null, tools: { mode: "any" } },
        target: { kind: "identity-glob", pattern: "*" },
        action: "block",
      }),
    );
    store.add(
      mk({
        id: "gr_agent_second",
        selector: { agent: "alpha", tools: { mode: "any" } },
        target: { kind: "identity-glob", pattern: "*" },
        action: "allow_notify",
      }),
    );
    const matched = store.match("alpha", "exec", { command: "ls" });
    expect(matched?.id).toBe("gr_global_first");
  });
  it("reverse: agent-first then global → agent fires (operator-controlled order)", () => {
    store.add(
      mk({
        id: "gr_agent_first",
        selector: { agent: "alpha", tools: { mode: "any" } },
        target: { kind: "identity-glob", pattern: "*" },
        action: "allow_notify",
      }),
    );
    store.add(
      mk({
        id: "gr_global_second",
        selector: { agent: null, tools: { mode: "any" } },
        target: { kind: "identity-glob", pattern: "*" },
        action: "block",
      }),
    );
    const matched = store.match("alpha", "exec", { command: "ls" });
    expect(matched?.id).toBe("gr_agent_first");
  });
});

// ── Identity-key memoization (§5.1) ───────────────────────────

describe("identity-key memoization", () => {
  it("extractIdentityKey is invoked at most once per match() regardless of N rules", () => {
    const spy = vi.mocked(identity.extractIdentityKey);
    spy.mockClear();
    // Add 5 identity-glob rules — they all need the identity key. Memoization
    // means extractIdentityKey runs once for the whole match() call.
    for (let i = 0; i < 5; i++) {
      store.add(
        mk({
          selector: { agent: null, tools: { mode: "any" } },
          target: { kind: "identity-glob", pattern: `none-of-these-match-${i}` },
        }),
      );
    }
    store.match("alpha", "exec", { command: "anything" });
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it("extractIdentityKey is NOT invoked when no identity-glob rule is in scope", () => {
    const spy = vi.mocked(identity.extractIdentityKey);
    spy.mockClear();
    store.add(
      mk({
        selector: { agent: null, tools: { mode: "any" } },
        target: { kind: "path-glob", pattern: "/etc/**" },
      }),
    );
    store.match("alpha", "read", { path: "/tmp/scratch" });
    expect(spy).not.toHaveBeenCalled();
  });
});

// ── findEquivalent + idempotency ──────────────────────────────

describe("findEquivalent — canonical-form deep-equal", () => {
  function makeNew(opts: Partial<NewGuardrail>): NewGuardrail {
    return {
      selector: { agent: null, tools: { mode: "any" } },
      target: { kind: "identity-glob", pattern: "x" },
      action: "block",
      source: { toolCallId: "tc_1", sessionKey: "sess_1", agentId: "alpha" },
      riskScore: 0,
      ...opts,
    };
  }

  it("returns the existing rule when selector + target are identical", () => {
    const r = mk({
      selector: { agent: null, tools: { mode: "names", values: ["write"] } },
      target: { kind: "path-glob", pattern: "/etc/**" },
    });
    store.add(r);
    const found = store.findEquivalent(
      makeNew({
        selector: { agent: null, tools: { mode: "names", values: ["write"] } },
        target: { kind: "path-glob", pattern: "/etc/**" },
      }),
    );
    expect(found?.id).toBe(r.id);
  });
  it("treats names-mode arrays as canonical-sorted (insertion order doesn't matter)", () => {
    const r = mk({
      selector: { agent: null, tools: { mode: "names", values: ["edit", "write"] } },
      target: { kind: "path-glob", pattern: "/etc/**" },
    });
    store.add(r);
    const found = store.findEquivalent(
      makeNew({
        selector: { agent: null, tools: { mode: "names", values: ["write", "edit"] } },
        target: { kind: "path-glob", pattern: "/etc/**" },
      }),
    );
    expect(found?.id).toBe(r.id);
  });
  it("differs by action does NOT make rules distinct (idempotency)", () => {
    const r = mk({
      selector: { agent: null, tools: { mode: "any" } },
      target: { kind: "path-glob", pattern: "/etc/**" },
      action: "block",
    });
    store.add(r);
    const found = store.findEquivalent(
      makeNew({
        selector: { agent: null, tools: { mode: "any" } },
        target: { kind: "path-glob", pattern: "/etc/**" },
        action: "require_approval",
      }),
    );
    expect(found?.id).toBe(r.id);
  });
  it("differs by note does NOT make rules distinct", () => {
    const r = mk({
      selector: { agent: null, tools: { mode: "any" } },
      target: { kind: "path-glob", pattern: "/etc/**" },
      note: "first",
    });
    store.add(r);
    const found = store.findEquivalent(
      makeNew({
        selector: { agent: null, tools: { mode: "any" } },
        target: { kind: "path-glob", pattern: "/etc/**" },
        note: "second",
      }),
    );
    expect(found?.id).toBe(r.id);
  });
  it("returns null for distinct selector (different agent)", () => {
    store.add(
      mk({
        selector: { agent: "alpha", tools: { mode: "any" } },
        target: { kind: "path-glob", pattern: "/etc/**" },
      }),
    );
    expect(
      store.findEquivalent(
        makeNew({
          selector: { agent: null, tools: { mode: "any" } },
          target: { kind: "path-glob", pattern: "/etc/**" },
        }),
      ),
    ).toBeNull();
  });
  it("returns null for distinct target pattern", () => {
    store.add(
      mk({
        selector: { agent: null, tools: { mode: "any" } },
        target: { kind: "path-glob", pattern: "/etc/**" },
      }),
    );
    expect(
      store.findEquivalent(
        makeNew({
          selector: { agent: null, tools: { mode: "any" } },
          target: { kind: "path-glob", pattern: "/tmp/**" },
        }),
      ),
    ).toBeNull();
  });
  it("returns null for distinct target kind", () => {
    store.add(
      mk({
        selector: { agent: null, tools: { mode: "any" } },
        target: { kind: "path-glob", pattern: "/x" },
      }),
    );
    expect(
      store.findEquivalent(
        makeNew({
          selector: { agent: null, tools: { mode: "any" } },
          target: { kind: "identity-glob", pattern: "/x" },
        }),
      ),
    ).toBeNull();
  });
  it("returns null when a names-mode and any-mode have overlapping coverage but distinct shape", () => {
    store.add(
      mk({
        selector: { agent: null, tools: { mode: "names", values: ["write"] } },
        target: { kind: "path-glob", pattern: "/x" },
      }),
    );
    expect(
      store.findEquivalent(
        makeNew({
          selector: { agent: null, tools: { mode: "any" } },
          target: { kind: "path-glob", pattern: "/x" },
        }),
      ),
    ).toBeNull();
  });
});

// ── Load semantics — drop-invalid + clean-resave ──────────────

describe("GuardrailStore — load() drop-invalid behavior", () => {
  it("missing file → empty store, no error", () => {
    expect(store.list()).toEqual([]);
  });
  it("corrupt JSON → empty store, no error", () => {
    fs.writeFileSync(path.join(tmpDir, "guardrails.json"), "not json");
    const s2 = new GuardrailStore(path.join(tmpDir, "guardrails.json"));
    s2.load();
    expect(s2.list()).toEqual([]);
  });
  it("missing 'guardrails' field → empty store, no error", () => {
    fs.writeFileSync(path.join(tmpDir, "guardrails.json"), JSON.stringify({ foo: "bar" }));
    const s2 = new GuardrailStore(path.join(tmpDir, "guardrails.json"));
    s2.load();
    expect(s2.list()).toEqual([]);
  });
  it("drops legacy {type:'block'} object-action rules", () => {
    const file = path.join(tmpDir, "guardrails.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        guardrails: [
          {
            id: "gr_legacy",
            tool: "exec",
            identityKey: "x",
            matchMode: "exact",
            action: { type: "block" }, // legacy shape — invalid under new schema
            agentId: null,
            createdAt: "2026-01-01T00:00:00Z",
            source: { toolCallId: "tc", sessionKey: "s", agentId: "a" },
            description: "legacy",
            riskScore: 0,
          },
        ],
      }),
    );
    const s2 = new GuardrailStore(file);
    s2.load();
    expect(s2.list()).toEqual([]);
  });
  it("keeps valid rules and drops invalid in the same file", () => {
    const file = path.join(tmpDir, "guardrails.json");
    const validRule: Guardrail = mk({
      id: "gr_keep",
      selector: { agent: null, tools: { mode: "any" } },
      target: { kind: "path-glob", pattern: "/etc/**" },
      action: "block",
    });
    fs.writeFileSync(
      file,
      JSON.stringify({
        guardrails: [validRule, { id: "gr_drop", selector: null, target: null, action: "block" }],
      }),
    );
    const s2 = new GuardrailStore(file);
    s2.load();
    expect(s2.list()).toHaveLength(1);
    expect(s2.list()[0].id).toBe("gr_keep");
    // Cleaned file written back to disk.
    const reread = JSON.parse(fs.readFileSync(file, "utf-8"));
    expect(reread.guardrails).toHaveLength(1);
  });
});

// ── update() — restricted patch surface ───────────────────────

describe("update() — only patches action, note, selector.agent", () => {
  it("patches action", () => {
    const r = mk({ action: "block" });
    store.add(r);
    const updated = store.update(r.id, { action: "require_approval" });
    expect(updated?.action).toBe("require_approval");
  });
  it("patches note", () => {
    const r = mk({ note: "old" });
    store.add(r);
    const updated = store.update(r.id, { note: "new" });
    expect(updated?.note).toBe("new");
  });
  it("patches selector.agent (re-scope between this-agent and all)", () => {
    const r = mk({ selector: { agent: "alpha", tools: { mode: "any" } } });
    store.add(r);
    const updated = store.update(r.id, { agent: null });
    expect(updated?.selector.agent).toBeNull();
  });
  it("returns null for unknown id", () => {
    expect(store.update("nope", { action: "block" })).toBeNull();
  });
});
