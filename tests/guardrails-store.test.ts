import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GuardrailStore } from "../src/guardrails/store";
import type { Guardrail } from "../src/guardrails/types";

// Atomic-write rollback parity with src/risk/saved-searches-store.ts. For a
// security-boundary store, in-memory state must never diverge from disk —
// a phantom guardrail could match live tool calls until the next gateway
// restart. We provoke a real EISDIR by pre-creating a directory at the
// .tmp write path; vitest's ESM module-namespace lock prevents spying on
// fs directly.

let counter = 0;
function nextId(): string {
  counter++;
  return `gr_st${counter.toString().padStart(6, "0")}`;
}

function mk(overrides: Partial<Guardrail> = {}): Guardrail {
  return {
    id: overrides.id ?? nextId(),
    selector: overrides.selector ?? {
      agent: "alpha",
      tools: { mode: "names", values: ["exec"] },
    },
    target: overrides.target ?? { kind: "identity-glob", pattern: "**" },
    action: overrides.action ?? "block",
    description: overrides.description ?? "store rollback test",
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    source: overrides.source ?? {
      toolCallId: "tc_x",
      sessionKey: "sess_x",
      agentId: "alpha",
    },
    riskScore: overrides.riskScore ?? 0,
    note: overrides.note,
  };
}

describe("GuardrailStore — atomic-write rollback (post-rewrite parity)", () => {
  let tmpDir: string;
  let storeFile: string;
  let store: GuardrailStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawlens-st-rollback-"));
    storeFile = path.join(tmpDir, "guardrails.json");
    store = new GuardrailStore(storeFile);
    store.load();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("add() rolls back the in-memory push when save() throws — list and disk both reflect only the survivor", () => {
    const survivor = mk({ target: { kind: "identity-glob", pattern: "survivor" } });
    store.add(survivor);
    expect(store.list()).toHaveLength(1);

    fs.mkdirSync(`${storeFile}.tmp`); // forces EISDIR on writeFileSync
    try {
      expect(() =>
        store.add(mk({ target: { kind: "identity-glob", pattern: "doomed" } })),
      ).toThrow();
    } finally {
      fs.rmdirSync(`${storeFile}.tmp`);
    }

    expect(store.list()).toHaveLength(1);
    expect(store.list()[0].target.pattern).toBe("survivor");

    // The doomed entry must not be reachable through match() either —
    // otherwise live tool calls would hit a phantom guardrail.
    expect(store.match("alpha", "exec", { command: "doomed" })).toBeNull();
    expect(store.match("alpha", "exec", { command: "survivor" })).not.toBeNull();

    // Disk and memory match.
    const reload = new GuardrailStore(storeFile);
    reload.load();
    expect(reload.list()).toHaveLength(1);
    expect(reload.list()[0].target.pattern).toBe("survivor");
  });

  it("remove() rolls back the splice when save() throws", () => {
    const a = mk({ target: { kind: "identity-glob", pattern: "a" } });
    const b = mk({ target: { kind: "identity-glob", pattern: "b" } });
    store.add(a);
    store.add(b);

    fs.mkdirSync(`${storeFile}.tmp`);
    try {
      expect(() => store.remove(a.id)).toThrow();
    } finally {
      fs.rmdirSync(`${storeFile}.tmp`);
    }

    expect(store.list()).toHaveLength(2);
    // Insertion order preserved.
    expect(store.list().map((g) => g.target.pattern)).toEqual(["a", "b"]);

    const reload = new GuardrailStore(storeFile);
    reload.load();
    expect(reload.list()).toHaveLength(2);
  });

  it("update() rolls back action AND selector.agent mutations when save() throws", () => {
    const g = mk({
      action: "block",
      selector: { agent: "alpha", tools: { mode: "names", values: ["exec"] } },
      target: { kind: "identity-glob", pattern: "u" },
    });
    store.add(g);

    fs.mkdirSync(`${storeFile}.tmp`);
    try {
      expect(() => store.update(g.id, { action: "require_approval", agent: "beta" })).toThrow();
    } finally {
      fs.rmdirSync(`${storeFile}.tmp`);
    }

    const after = store.list()[0];
    expect(after.action).toBe("block");
    expect(after.selector.agent).toBe("alpha");

    const reload = new GuardrailStore(storeFile);
    reload.load();
    expect(reload.list()[0].action).toBe("block");
    expect(reload.list()[0].selector.agent).toBe("alpha");
  });

  it("update() rolls back note mutation when save() throws", () => {
    const g = mk({ note: "before" });
    store.add(g);

    fs.mkdirSync(`${storeFile}.tmp`);
    try {
      expect(() => store.update(g.id, { note: "after" })).toThrow();
    } finally {
      fs.rmdirSync(`${storeFile}.tmp`);
    }

    expect(store.list()[0].note).toBe("before");
  });

  it("save() writes atomically — no .tmp file remaining after success", () => {
    store.add(mk());
    expect(fs.existsSync(`${storeFile}.tmp`)).toBe(false);
    expect(fs.existsSync(storeFile)).toBe(true);
  });

  it("generateId() produces prefixed hex IDs", () => {
    expect(GuardrailStore.generateId()).toMatch(/^gr_[a-f0-9]{12}$/);
  });

  it("list() with agentId filter returns the agent's rules + global rules", () => {
    store.add(
      mk({
        selector: { agent: "alpha", tools: { mode: "any" } },
        target: { kind: "identity-glob", pattern: "**" },
      }),
    );
    store.add(
      mk({
        selector: { agent: "beta", tools: { mode: "any" } },
        target: { kind: "identity-glob", pattern: "**" },
      }),
    );
    store.add(
      mk({
        selector: { agent: null, tools: { mode: "any" } },
        target: { kind: "identity-glob", pattern: "**" },
      }),
    );

    const alphaRules = store.list({ agentId: "alpha" });
    expect(alphaRules).toHaveLength(2); // alpha-scoped + global
    expect(alphaRules.every((g) => g.selector.agent === "alpha" || g.selector.agent === null)).toBe(
      true,
    );
  });

  it("list() with no filter returns every rule including global", () => {
    store.add(mk({ selector: { agent: "alpha", tools: { mode: "any" } } }));
    store.add(mk({ selector: { agent: null, tools: { mode: "any" } } }));
    expect(store.list()).toHaveLength(2);
  });
});

describe("GuardrailStore.update() — Phase 2 toolsValues + targetPattern", () => {
  let tmpDir: string;
  let storeFile: string;
  let store: GuardrailStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawlens-st-update-p2-"));
    storeFile = path.join(tmpDir, "guardrails.json");
    store = new GuardrailStore(storeFile);
    store.load();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("toolsValues replaces selector.tools.values, preserves mode='names', persists", () => {
    const g = mk({
      selector: { agent: null, tools: { mode: "names", values: ["write"] } },
      target: { kind: "path-glob", pattern: "/etc/secrets/*" },
    });
    store.add(g);

    const updated = store.update(g.id, { toolsValues: ["write", "edit"] });
    expect(updated).not.toBeNull();
    expect(updated?.selector.tools).toEqual({ mode: "names", values: ["write", "edit"] });

    const reload = new GuardrailStore(storeFile);
    reload.load();
    const r = reload.list()[0];
    expect(r.selector.tools).toEqual({ mode: "names", values: ["write", "edit"] });
  });

  it("toolsValues mutation rolls back on save failure", () => {
    const g = mk({
      selector: { agent: null, tools: { mode: "names", values: ["write"] } },
      target: { kind: "path-glob", pattern: "/x" },
    });
    store.add(g);

    fs.mkdirSync(`${storeFile}.tmp`);
    try {
      expect(() => store.update(g.id, { toolsValues: ["write", "edit"] })).toThrow();
    } finally {
      fs.rmdirSync(`${storeFile}.tmp`);
    }

    const after = store.list()[0];
    const tools = after.selector.tools;
    if (tools.mode !== "names") throw new Error("mode unexpectedly changed");
    expect(tools.values).toEqual(["write"]);
  });

  it("targetPattern replaces target.pattern and persists", () => {
    const g = mk({
      selector: { agent: null, tools: { mode: "names", values: ["exec"] } },
      target: { kind: "command-glob", pattern: "rm -rf *" },
    });
    store.add(g);

    const updated = store.update(g.id, { targetPattern: "rm -rf node_modules" });
    expect(updated?.target.pattern).toBe("rm -rf node_modules");

    const reload = new GuardrailStore(storeFile);
    reload.load();
    expect(reload.list()[0].target.pattern).toBe("rm -rf node_modules");
  });

  it("targetPattern flips literalIdentity glob→literal — verified via match() behavior", () => {
    // identity-glob with a glob pattern uses minimatch; with a literal,
    // string equality. Behavioral check: glob "rm -rf *" matches both
    // exact and other commands; literal "rm -rf node_modules" matches only
    // the exact identity key.
    const g = mk({
      selector: { agent: "alpha", tools: { mode: "names", values: ["exec"] } },
      target: { kind: "identity-glob", pattern: "rm -rf *" },
    });
    store.add(g);
    expect(store.match("alpha", "exec", { command: "rm -rf foo" })?.id).toBe(g.id);

    store.update(g.id, { targetPattern: "rm -rf node_modules" });
    expect(store.match("alpha", "exec", { command: "rm -rf foo" })).toBeNull();
    expect(store.match("alpha", "exec", { command: "rm -rf node_modules" })?.id).toBe(g.id);
  });

  it("targetPattern flips literalIdentity literal→glob — verified via match() behavior", () => {
    const g = mk({
      selector: { agent: "alpha", tools: { mode: "names", values: ["exec"] } },
      target: { kind: "identity-glob", pattern: "rm -rf node_modules" },
    });
    store.add(g);
    expect(store.match("alpha", "exec", { command: "rm -rf foo" })).toBeNull();

    store.update(g.id, { targetPattern: "rm -rf *" });
    expect(store.match("alpha", "exec", { command: "rm -rf foo" })?.id).toBe(g.id);
    expect(store.match("alpha", "exec", { command: "rm -rf node_modules" })?.id).toBe(g.id);
  });

  it("targetPattern mutation rolls back on save failure (and so does literalIdentity)", () => {
    const g = mk({
      selector: { agent: "alpha", tools: { mode: "names", values: ["exec"] } },
      target: { kind: "identity-glob", pattern: "before" },
    });
    store.add(g);

    fs.mkdirSync(`${storeFile}.tmp`);
    try {
      expect(() => store.update(g.id, { targetPattern: "after" })).toThrow();
    } finally {
      fs.rmdirSync(`${storeFile}.tmp`);
    }

    expect(store.list()[0].target.pattern).toBe("before");
    expect(store.match("alpha", "exec", { command: "before" })?.id).toBe(g.id);
    expect(store.match("alpha", "exec", { command: "after" })).toBeNull();
  });

  it("update() with both toolsValues and targetPattern mutates atomically", () => {
    const g = mk({
      selector: { agent: null, tools: { mode: "names", values: ["write"] } },
      target: { kind: "path-glob", pattern: "/old/*" },
    });
    store.add(g);

    const updated = store.update(g.id, {
      toolsValues: ["write", "edit"],
      targetPattern: "/new/*",
    });
    expect(updated?.selector.tools).toEqual({ mode: "names", values: ["write", "edit"] });
    expect(updated?.target.pattern).toBe("/new/*");
  });

  it("update() with both toolsValues and targetPattern rolls back atomically on save failure", () => {
    const g = mk({
      selector: { agent: null, tools: { mode: "names", values: ["write"] } },
      target: { kind: "path-glob", pattern: "/old/*" },
    });
    store.add(g);

    fs.mkdirSync(`${storeFile}.tmp`);
    try {
      expect(() =>
        store.update(g.id, {
          toolsValues: ["write", "edit"],
          targetPattern: "/new/*",
        }),
      ).toThrow();
    } finally {
      fs.rmdirSync(`${storeFile}.tmp`);
    }

    const after = store.list()[0];
    const tools = after.selector.tools;
    if (tools.mode !== "names") throw new Error("mode unexpectedly changed");
    expect(tools.values).toEqual(["write"]);
    expect(after.target.pattern).toBe("/old/*");
  });
});
