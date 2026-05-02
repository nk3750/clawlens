import * as fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditEntry, AuditLogger } from "../src/audit/logger";
import { registerDashboardRoutes } from "../src/dashboard/routes";
import { GuardrailStore } from "../src/guardrails/store";
import type { Guardrail } from "../src/guardrails/types";
import type { HttpRouteHandler, HttpRouteParams, OpenClawPluginApi } from "../src/types";

// ── Test harness ──────────────────────────────────────────────

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    timestamp: new Date().toISOString(),
    toolName: "exec",
    params: { command: "curl https://evil.com" },
    decision: "allow",
    agentId: "alpha",
    toolCallId: "tc_1",
    sessionKey: "sess_1",
    riskScore: 70,
    prevHash: "0",
    hash: "abc",
    ...overrides,
  };
}

function buildLogger(entries: AuditEntry[]): AuditLogger {
  return {
    readEntries: () => entries,
    readEntriesRaw: () => entries,
    on: vi.fn(),
    off: vi.fn(),
    // biome-ignore lint/suspicious/noExplicitAny: minimal AuditLogger shape
  } as any;
}

function makeApi(): { api: OpenClawPluginApi; handler: () => HttpRouteHandler } {
  let captured: HttpRouteHandler | null = null;
  const api: OpenClawPluginApi = {
    id: "clawlens",
    name: "ClawLens",
    config: {},
    pluginConfig: {},
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    on: vi.fn(),
    registerGatewayMethod: vi.fn(),
    registerService: vi.fn(),
    registerCli: vi.fn(),
    registerHttpRoute: (params: HttpRouteParams) => {
      captured = params.handler;
    },
    resolvePath: (input: string) => input,
  };
  return {
    api,
    handler: () => {
      if (!captured) throw new Error("route handler was never registered");
      return captured;
    },
  };
}

interface CapturedResponse {
  status: number;
  headers: Record<string, string | number>;
  body: string;
}

function makeReq(url: string, opts: { method?: string; body?: unknown } = {}): IncomingMessage {
  const bodyStr = opts.body !== undefined ? JSON.stringify(opts.body) : "";
  const handlers: Record<string, Array<(chunk?: Buffer | string) => void>> = {};
  const req = {
    url,
    method: opts.method ?? "GET",
    headers: { host: "localhost:18789" },
    on: (event: string, handler: (chunk?: Buffer | string) => void) => {
      let list = handlers[event];
      if (!list) {
        list = [];
        handlers[event] = list;
      }
      list.push(handler);
      if (event === "end") {
        queueMicrotask(() => {
          if (bodyStr) {
            for (const h of handlers.data ?? []) h(Buffer.from(bodyStr));
          }
          handler();
        });
      }
    },
    // biome-ignore lint/suspicious/noExplicitAny: minimal IncomingMessage shape
  } as any;
  return req;
}

function makeRes(): { res: ServerResponse; out: CapturedResponse } {
  const out: CapturedResponse = { status: 0, headers: {}, body: "" };
  const res = {
    writeHead: (code: number, headers?: Record<string, string | number>) => {
      out.status = code;
      if (headers) Object.assign(out.headers, headers);
    },
    write: (chunk: string) => {
      out.body += chunk;
    },
    end: (chunk?: string) => {
      if (chunk) out.body += chunk;
    },
    // biome-ignore lint/suspicious/noExplicitAny: minimal ServerResponse shape
  } as any;
  return { res, out };
}

function tmpGuardrails(): { store: GuardrailStore; cleanup: () => void; file: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawlens-gr-routes-"));
  const file = path.join(dir, "guardrails.json");
  const store = new GuardrailStore(file);
  store.load();
  return { store, file, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

let counter = 0;
function nextId(): string {
  counter++;
  return `gr_rt${counter.toString().padStart(6, "0")}`;
}

// Build a fully-formed Guardrail. Tests override exactly what they care about.
function mkRule(overrides: Partial<Guardrail> = {}): Guardrail {
  return {
    id: overrides.id ?? nextId(),
    selector: overrides.selector ?? {
      agent: null,
      tools: { mode: "names", values: ["exec"] },
    },
    target: overrides.target ?? { kind: "identity-glob", pattern: "**" },
    action: overrides.action ?? "block",
    description: overrides.description ?? "test",
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

// Build a guardrail_match audit row — params shape mirrors what
// AuditLogger.logGuardrailMatch produces.
function gMatchEntry(overrides: {
  guardrailId: string;
  timestamp: string;
  toolCallId?: string;
  toolName?: string;
  agentId?: string;
  sessionKey?: string;
  action?: "block" | "require_approval" | "allow_notify";
  identityKey?: string;
  targetSummary?: string;
}): AuditEntry {
  const action = overrides.action ?? "block";
  return entry({
    timestamp: overrides.timestamp,
    toolName: overrides.toolName ?? "exec",
    toolCallId: overrides.toolCallId,
    agentId: overrides.agentId ?? "alpha",
    sessionKey: overrides.sessionKey,
    decision:
      action === "block" ? "block" : action === "require_approval" ? "approval_required" : "allow",
    params: {
      guardrailId: overrides.guardrailId,
      guardrailAction: action,
      identityKey: overrides.identityKey ?? "x",
      targetSummary: overrides.targetSummary,
    },
  });
}

// ── POST validation ──────────────────────────────────────────

describe("POST /api/guardrails — validation + idempotency", () => {
  let api: OpenClawPluginApi;
  let getHandler: () => HttpRouteHandler;
  let cleanupStore: () => void;
  let store: GuardrailStore;

  beforeEach(() => {
    const made = makeApi();
    api = made.api;
    getHandler = made.handler;
    const t = tmpGuardrails();
    store = t.store;
    cleanupStore = t.cleanup;
    registerDashboardRoutes(api, {
      auditLogger: buildLogger([]),
      guardrailStore: store,
    });
  });

  afterEach(() => {
    cleanupStore();
  });

  function postBody(body: unknown) {
    const r = makeRes();
    return getHandler()(
      makeReq("/plugins/clawlens/api/guardrails", { method: "POST", body }),
      r.res,
    ).then(() => r.out);
  }

  const validBody = {
    selector: { agent: null, tools: { mode: "names", values: ["exec"] } },
    target: { kind: "identity-glob", pattern: "rm -rf node_modules" },
    action: "block",
    source: { toolCallId: "tc_1", sessionKey: "sess_1", agentId: "alpha" },
    riskScore: 50,
  };

  it("creates a rule and auto-generates description (selector + target + action)", async () => {
    const out = await postBody(validBody);
    expect(out.status).toBe(200);
    const body = JSON.parse(out.body);
    expect(body.id).toMatch(/^gr_/);
    expect(body.description).toBe("Block exec tool identity matching 'rm -rf node_modules'");
    expect(body.selector).toEqual(validBody.selector);
    expect(body.target).toEqual(validBody.target);
    expect(body.action).toBe("block");
    expect(body.createdAt).toBeTypeOf("string");
    expect(body.existing).toBeFalsy();
    expect(store.list()).toHaveLength(1);
  });

  it("operator-supplied description overrides the auto-generator", async () => {
    const out = await postBody({ ...validBody, description: "OP CHOSEN" });
    expect(out.status).toBe(200);
    expect(JSON.parse(out.body).description).toBe("OP CHOSEN");
  });

  it("persists optional note", async () => {
    const out = await postBody({ ...validBody, note: "auditing this" });
    expect(JSON.parse(out.body).note).toBe("auditing this");
  });

  it("rejects empty target.pattern (400)", async () => {
    const out = await postBody({
      ...validBody,
      target: { kind: "path-glob", pattern: "" },
    });
    expect(out.status).toBe(400);
  });

  it("rejects empty tools.values when mode=names (400)", async () => {
    const out = await postBody({
      ...validBody,
      selector: { agent: null, tools: { mode: "names", values: [] } },
    });
    expect(out.status).toBe(400);
  });

  it("rejects unknown ActivityCategory (400)", async () => {
    const out = await postBody({
      ...validBody,
      selector: { agent: null, tools: { mode: "category", value: "rabbits" } },
    });
    expect(out.status).toBe(400);
  });

  it("rejects unknown action (400)", async () => {
    const out = await postBody({ ...validBody, action: "delete" });
    expect(out.status).toBe(400);
  });

  it("rejects legacy {type:'block'} action shape (400)", async () => {
    const out = await postBody({ ...validBody, action: { type: "block" } });
    expect(out.status).toBe(400);
  });

  it("rejects missing source (400)", async () => {
    const { source: _s, ...rest } = validBody;
    const out = await postBody(rest);
    expect(out.status).toBe(400);
  });

  it("emits warning for unknown tool name (saves rule, includes warnings)", async () => {
    const out = await postBody({
      ...validBody,
      selector: { agent: null, tools: { mode: "names", values: ["bogus_tool"] } },
    });
    expect(out.status).toBe(200);
    const body = JSON.parse(out.body);
    expect(body.warnings).toBeDefined();
    expect(body.warnings.some((w: string) => /bogus_tool/.test(w))).toBe(true);
    expect(store.list()).toHaveLength(1);
  });

  it("dedupes duplicate tool names and emits a removal warning", async () => {
    const out = await postBody({
      ...validBody,
      selector: { agent: null, tools: { mode: "names", values: ["exec", "exec", "write"] } },
    });
    expect(out.status).toBe(200);
    const body = JSON.parse(out.body);
    expect(body.selector.tools.values).toEqual(["exec", "write"]);
    expect(body.warnings.some((w: string) => /duplicate/.test(w))).toBe(true);
  });

  it("idempotent: equivalent (selector, target) returns existing rule", async () => {
    const r1 = await postBody(validBody);
    const r2 = await postBody({
      ...validBody,
      // Different action AND note — must NOT create a new rule.
      action: "require_approval",
      note: "different",
    });
    expect(r2.status).toBe(200);
    const body = JSON.parse(r2.body);
    expect(body.existing).toBe(true);
    expect(body.id).toBe(JSON.parse(r1.body).id);
    // Original action preserved (not overwritten by second POST).
    expect(body.action).toBe("block");
    expect(store.list()).toHaveLength(1);
  });

  it("idempotent: names-mode with reordered values is still equivalent", async () => {
    await postBody({
      ...validBody,
      selector: { agent: null, tools: { mode: "names", values: ["edit", "write"] } },
      target: { kind: "path-glob", pattern: "/x" },
    });
    const r = await postBody({
      ...validBody,
      selector: { agent: null, tools: { mode: "names", values: ["write", "edit"] } },
      target: { kind: "path-glob", pattern: "/x" },
    });
    expect(JSON.parse(r.body).existing).toBe(true);
    expect(store.list()).toHaveLength(1);
  });
});

// ── PATCH ───────────────────────────────────────────────────

describe("PATCH /api/guardrails/:id", () => {
  let api: OpenClawPluginApi;
  let getHandler: () => HttpRouteHandler;
  let cleanupStore: () => void;
  let store: GuardrailStore;

  beforeEach(() => {
    const made = makeApi();
    api = made.api;
    getHandler = made.handler;
    const t = tmpGuardrails();
    store = t.store;
    cleanupStore = t.cleanup;
    registerDashboardRoutes(api, {
      auditLogger: buildLogger([]),
      guardrailStore: store,
    });
  });

  afterEach(() => {
    cleanupStore();
  });

  function patchBody(id: string, body: unknown) {
    const r = makeRes();
    return getHandler()(
      makeReq(`/plugins/clawlens/api/guardrails/${id}`, { method: "PATCH", body }),
      r.res,
    ).then(() => r.out);
  }

  it("patches action", async () => {
    const r = mkRule({ action: "block" });
    store.add(r);
    const out = await patchBody(r.id, { action: "require_approval" });
    expect(out.status).toBe(200);
    expect(JSON.parse(out.body).action).toBe("require_approval");
  });

  it("patches note", async () => {
    const r = mkRule();
    store.add(r);
    const out = await patchBody(r.id, { note: "patched" });
    expect(out.status).toBe(200);
    expect(JSON.parse(out.body).note).toBe("patched");
  });

  it("patches selector.agent (re-scope)", async () => {
    const r = mkRule({ selector: { agent: "alpha", tools: { mode: "any" } } });
    store.add(r);
    const out = await patchBody(r.id, { agent: null });
    expect(out.status).toBe(200);
    expect(JSON.parse(out.body).selector.agent).toBeNull();
  });

  it("rejects patching selector.tools (400)", async () => {
    const r = mkRule({ selector: { agent: null, tools: { mode: "names", values: ["exec"] } } });
    store.add(r);
    const out = await patchBody(r.id, { tools: { mode: "any" } });
    expect(out.status).toBe(400);
  });

  it("rejects patching target (400)", async () => {
    const r = mkRule();
    store.add(r);
    const out = await patchBody(r.id, { target: { kind: "path-glob", pattern: "/x" } });
    expect(out.status).toBe(400);
  });

  it("rejects unknown action (400)", async () => {
    const r = mkRule();
    store.add(r);
    const out = await patchBody(r.id, { action: "delete" });
    expect(out.status).toBe(400);
  });

  it("returns 404 for unknown id", async () => {
    const out = await patchBody("gr_unknown", { action: "block" });
    expect(out.status).toBe(404);
  });
});

// ── PATCH — Phase 2 (tools.values + target.pattern relaxation) ──

describe("PATCH /api/guardrails/:id — Phase 2 allowlist (tools.values + target.pattern)", () => {
  let api: OpenClawPluginApi;
  let getHandler: () => HttpRouteHandler;
  let cleanupStore: () => void;
  let store: GuardrailStore;

  beforeEach(() => {
    const made = makeApi();
    api = made.api;
    getHandler = made.handler;
    const t = tmpGuardrails();
    store = t.store;
    cleanupStore = t.cleanup;
    registerDashboardRoutes(api, {
      auditLogger: buildLogger([]),
      guardrailStore: store,
    });
  });

  afterEach(() => {
    cleanupStore();
  });

  function patchBody(id: string, body: unknown) {
    const r = makeRes();
    return getHandler()(
      makeReq(`/plugins/clawlens/api/guardrails/${id}`, { method: "PATCH", body }),
      r.res,
    ).then(() => r.out);
  }

  it("PATCH tools.values on names-mode rule replaces values (200) and persists", async () => {
    const r = mkRule({
      selector: { agent: null, tools: { mode: "names", values: ["write"] } },
      target: { kind: "path-glob", pattern: "/etc/*" },
    });
    store.add(r);

    const out = await patchBody(r.id, { tools: { values: ["write", "edit"] } });
    expect(out.status).toBe(200);
    const body = JSON.parse(out.body);
    expect(body.selector.tools).toEqual({ mode: "names", values: ["write", "edit"] });
    // Persisted in-memory.
    const stored = store.list()[0];
    if (stored.selector.tools.mode !== "names") throw new Error("mode unexpectedly changed");
    expect(stored.selector.tools.values).toEqual(["write", "edit"]);
  });

  it("PATCH tools.values empty array → 400", async () => {
    const r = mkRule({
      selector: { agent: null, tools: { mode: "names", values: ["write"] } },
    });
    store.add(r);
    const out = await patchBody(r.id, { tools: { values: [] } });
    expect(out.status).toBe(400);
  });

  it("PATCH tools.values entries must be non-empty strings → 400", async () => {
    const r = mkRule({
      selector: { agent: null, tools: { mode: "names", values: ["write"] } },
    });
    store.add(r);
    const out = await patchBody(r.id, { tools: { values: ["write", ""] } });
    expect(out.status).toBe(400);
  });

  it("PATCH tools.values on category-mode rule → 400 (editable only on names-mode)", async () => {
    const r = mkRule({
      selector: { agent: null, tools: { mode: "category", value: "changes" } },
    });
    store.add(r);
    const out = await patchBody(r.id, { tools: { values: ["write"] } });
    expect(out.status).toBe(400);
    expect(JSON.parse(out.body).error).toMatch(/names-mode/i);
  });

  it("PATCH tools.values on mode='any' rule → 400 (editable only on names-mode)", async () => {
    const r = mkRule({
      selector: { agent: null, tools: { mode: "any" } },
    });
    store.add(r);
    const out = await patchBody(r.id, { tools: { values: ["exec"] } });
    expect(out.status).toBe(400);
    expect(JSON.parse(out.body).error).toMatch(/names-mode/i);
  });

  it("PATCH tools.values with duplicates → 200 + dedup warning", async () => {
    const r = mkRule({
      selector: { agent: null, tools: { mode: "names", values: ["write"] } },
    });
    store.add(r);

    const out = await patchBody(r.id, { tools: { values: ["write", "write", "edit"] } });
    expect(out.status).toBe(200);
    const body = JSON.parse(out.body);
    expect(body.selector.tools.values).toEqual(["write", "edit"]);
    expect(body.warnings).toBeDefined();
    expect(body.warnings.some((w: string) => /duplicate/.test(w))).toBe(true);
  });

  it("PATCH tools.values with unknown tool name → 200 + unknown-tool warning", async () => {
    const r = mkRule({
      selector: { agent: null, tools: { mode: "names", values: ["exec"] } },
    });
    store.add(r);

    const out = await patchBody(r.id, { tools: { values: ["exec", "bogus_tool"] } });
    expect(out.status).toBe(200);
    const body = JSON.parse(out.body);
    expect(body.warnings).toBeDefined();
    expect(body.warnings.some((w: string) => /bogus_tool/.test(w))).toBe(true);
  });

  it("PATCH tools.mode → 400 (still locked)", async () => {
    const r = mkRule({
      selector: { agent: null, tools: { mode: "names", values: ["exec"] } },
    });
    store.add(r);
    const out = await patchBody(r.id, { tools: { mode: "any" } });
    expect(out.status).toBe(400);
    expect(JSON.parse(out.body).error).toMatch(/mode is immutable/i);
  });

  it("PATCH target.pattern valid → 200, store updated", async () => {
    const r = mkRule({
      selector: { agent: null, tools: { mode: "names", values: ["exec"] } },
      target: { kind: "command-glob", pattern: "rm -rf *" },
    });
    store.add(r);

    const out = await patchBody(r.id, { target: { pattern: "rm -rf node_modules" } });
    expect(out.status).toBe(200);
    expect(JSON.parse(out.body).target.pattern).toBe("rm -rf node_modules");
    expect(store.list()[0].target.pattern).toBe("rm -rf node_modules");
  });

  it("PATCH target.pattern empty → 400", async () => {
    const r = mkRule({
      target: { kind: "identity-glob", pattern: "before" },
    });
    store.add(r);
    const out = await patchBody(r.id, { target: { pattern: "" } });
    expect(out.status).toBe(400);
  });

  it("PATCH target.kind → 400 (still locked)", async () => {
    const r = mkRule({
      target: { kind: "identity-glob", pattern: "x" },
    });
    store.add(r);
    const out = await patchBody(r.id, { target: { kind: "path-glob" } });
    expect(out.status).toBe(400);
    expect(JSON.parse(out.body).error).toMatch(/kind is immutable/i);
  });

  it("PATCH target.pattern from glob to literal flips literalIdentity (verified via match)", async () => {
    const r = mkRule({
      selector: { agent: "alpha", tools: { mode: "names", values: ["exec"] } },
      target: { kind: "identity-glob", pattern: "rm -rf *" },
    });
    store.add(r);
    expect(store.match("alpha", "exec", { command: "rm -rf foo" })?.id).toBe(r.id);

    const out = await patchBody(r.id, { target: { pattern: "rm -rf node_modules" } });
    expect(out.status).toBe(200);
    expect(store.match("alpha", "exec", { command: "rm -rf foo" })).toBeNull();
    expect(store.match("alpha", "exec", { command: "rm -rf node_modules" })?.id).toBe(r.id);
  });

  it("PATCH target.pattern from literal to glob flips literalIdentity back", async () => {
    const r = mkRule({
      selector: { agent: "alpha", tools: { mode: "names", values: ["exec"] } },
      target: { kind: "identity-glob", pattern: "rm -rf node_modules" },
    });
    store.add(r);
    expect(store.match("alpha", "exec", { command: "rm -rf foo" })).toBeNull();

    const out = await patchBody(r.id, { target: { pattern: "rm -rf *" } });
    expect(out.status).toBe(200);
    expect(store.match("alpha", "exec", { command: "rm -rf foo" })?.id).toBe(r.id);
  });

  it("PATCH multi-field body (action + note + tools.values) updates all atomically (200)", async () => {
    const r = mkRule({
      selector: { agent: null, tools: { mode: "names", values: ["write"] } },
      action: "block",
      note: "before",
    });
    store.add(r);

    const out = await patchBody(r.id, {
      action: "require_approval",
      note: "after",
      tools: { values: ["write", "edit"] },
    });
    expect(out.status).toBe(200);
    const body = JSON.parse(out.body);
    expect(body.action).toBe("require_approval");
    expect(body.note).toBe("after");
    expect(body.selector.tools.values).toEqual(["write", "edit"]);
  });
});

// ── GET (list, enriched) ─────────────────────────────────────

describe("GET /api/guardrails — enriched with hits24h / hits7d / lastFiredAt", () => {
  let api: OpenClawPluginApi;
  let getHandler: () => HttpRouteHandler;
  let cleanupStore: () => void;
  let store: GuardrailStore;

  beforeEach(() => {
    const made = makeApi();
    api = made.api;
    getHandler = made.handler;
    const t = tmpGuardrails();
    store = t.store;
    cleanupStore = t.cleanup;
  });

  afterEach(() => {
    cleanupStore();
  });

  it("returns hits24h + hits7d + lastFiredAt counted from guardrail_match audit rows", async () => {
    const r = mkRule({ id: "gr_hit_test" });
    store.add(r);
    const now = Date.now();
    const audit = [
      gMatchEntry({
        guardrailId: "gr_hit_test",
        timestamp: new Date(now - 1 * 3600_000).toISOString(),
        action: "block",
      }),
      gMatchEntry({
        guardrailId: "gr_hit_test",
        timestamp: new Date(now - 5 * 3600_000).toISOString(),
        action: "block",
      }),
      // Outside 24h, inside 7d
      gMatchEntry({
        guardrailId: "gr_hit_test",
        timestamp: new Date(now - 3 * 86400_000).toISOString(),
        action: "block",
      }),
      // Outside 7d
      gMatchEntry({
        guardrailId: "gr_hit_test",
        timestamp: new Date(now - 10 * 86400_000).toISOString(),
        action: "block",
      }),
      // Different rule — must not count
      gMatchEntry({
        guardrailId: "gr_other",
        timestamp: new Date(now - 1 * 3600_000).toISOString(),
        action: "block",
      }),
    ];
    registerDashboardRoutes(api, {
      auditLogger: buildLogger(audit),
      guardrailStore: store,
    });
    const { res, out } = makeRes();
    await getHandler()(makeReq("/plugins/clawlens/api/guardrails"), res);
    expect(out.status).toBe(200);
    const body = JSON.parse(out.body);
    const enriched = body.guardrails.find((g: { id: string }) => g.id === "gr_hit_test");
    expect(enriched.hits24h).toBe(2);
    expect(enriched.hits7d).toBe(3);
    expect(enriched.lastFiredAt).toBe(audit[0].timestamp);
  });

  it("returns hits24h=0 / lastFiredAt=null when the rule never fired", async () => {
    const r = mkRule({ id: "gr_quiet" });
    store.add(r);
    registerDashboardRoutes(api, {
      auditLogger: buildLogger([]),
      guardrailStore: store,
    });
    const { res, out } = makeRes();
    await getHandler()(makeReq("/plugins/clawlens/api/guardrails"), res);
    const body = JSON.parse(out.body);
    expect(body.guardrails[0].hits24h).toBe(0);
    expect(body.guardrails[0].hits7d).toBe(0);
    expect(body.guardrails[0].lastFiredAt).toBeNull();
  });
});

// ── GET /:id/stats and /:id/firings ──────────────────────────

describe("GET /api/guardrails/:id/stats — sparkline", () => {
  let api: OpenClawPluginApi;
  let getHandler: () => HttpRouteHandler;
  let cleanupStore: () => void;
  let store: GuardrailStore;

  beforeEach(() => {
    const made = makeApi();
    api = made.api;
    getHandler = made.handler;
    const t = tmpGuardrails();
    store = t.store;
    cleanupStore = t.cleanup;
  });

  afterEach(() => {
    cleanupStore();
  });

  it("returns 24-element sparkline + hits24h + lastFiredAt", async () => {
    const r = mkRule({ id: "gr_spark" });
    store.add(r);
    const now = Date.now();
    const audit = [
      gMatchEntry({
        guardrailId: "gr_spark",
        timestamp: new Date(now - 3 * 3600_000 - 30_000).toISOString(),
      }),
      gMatchEntry({
        guardrailId: "gr_spark",
        timestamp: new Date(now - 3 * 3600_000 - 15_000).toISOString(),
      }),
      gMatchEntry({
        guardrailId: "gr_spark",
        timestamp: new Date(now - 1 * 3600_000).toISOString(),
      }),
    ];
    registerDashboardRoutes(api, {
      auditLogger: buildLogger(audit),
      guardrailStore: store,
    });
    const { res, out } = makeRes();
    await getHandler()(makeReq("/plugins/clawlens/api/guardrails/gr_spark/stats?window=24h"), res);
    expect(out.status).toBe(200);
    const body = JSON.parse(out.body);
    expect(body.id).toBe("gr_spark");
    expect(body.hits24h).toBe(3);
    expect(body.sparkline).toHaveLength(24);
    // Sum across the 24 buckets equals hits24h.
    const total = body.sparkline.reduce((a: number, b: number) => a + b, 0);
    expect(total).toBe(3);
    expect(body.lastFiredAt).toBe(audit[2].timestamp);
  });

  it("returns 404 for unknown id", async () => {
    registerDashboardRoutes(api, {
      auditLogger: buildLogger([]),
      guardrailStore: store,
    });
    const { res, out } = makeRes();
    await getHandler()(makeReq("/plugins/clawlens/api/guardrails/gr_nope/stats?window=24h"), res);
    expect(out.status).toBe(404);
  });
});

describe("GET /api/guardrails/:id/firings — recent firings + resolutions", () => {
  let api: OpenClawPluginApi;
  let getHandler: () => HttpRouteHandler;
  let cleanupStore: () => void;
  let store: GuardrailStore;

  beforeEach(() => {
    const made = makeApi();
    api = made.api;
    getHandler = made.handler;
    const t = tmpGuardrails();
    store = t.store;
    cleanupStore = t.cleanup;
  });

  afterEach(() => {
    cleanupStore();
  });

  it("returns firings with joined resolution status", async () => {
    const r = mkRule({ id: "gr_fire" });
    store.add(r);
    const now = Date.now();
    const audit: AuditEntry[] = [
      gMatchEntry({
        guardrailId: "gr_fire",
        timestamp: new Date(now - 60_000).toISOString(),
        toolCallId: "tc_a",
        action: "require_approval",
        agentId: "alpha",
        sessionKey: "s_a",
      }),
      // matching guardrail_resolution row — same toolCallId, decision approved
      entry({
        timestamp: new Date(now - 30_000).toISOString(),
        toolCallId: "tc_a",
        decision: "allow",
        userResponse: "approved",
        agentId: "alpha",
        sessionKey: "s_a",
        params: { guardrailId: "gr_fire", resolution: "allow-once" },
      }),
      // an allow_notify firing, no resolution needed
      gMatchEntry({
        guardrailId: "gr_fire",
        timestamp: new Date(now - 20_000).toISOString(),
        toolCallId: "tc_b",
        action: "allow_notify",
        agentId: "alpha",
        sessionKey: "s_a",
      }),
    ];
    registerDashboardRoutes(api, {
      auditLogger: buildLogger(audit),
      guardrailStore: store,
    });
    const { res, out } = makeRes();
    await getHandler()(makeReq("/plugins/clawlens/api/guardrails/gr_fire/firings"), res);
    expect(out.status).toBe(200);
    const body = JSON.parse(out.body);
    expect(body.firings).toHaveLength(2);
    const approved = body.firings.find(
      (f: { toolCallId?: string }) => f.toolCallId === undefined || true,
    );
    expect(approved).toBeDefined();
    // Sorted newest-first.
    expect(body.firings[0].at >= body.firings[1].at).toBe(true);
    // Approval firing has resolution="approved"
    const approvalFiring = body.firings.find((f: { resolution: string }) =>
      ["approved", "denied", "pending"].includes(f.resolution),
    );
    expect(approvalFiring).toBeDefined();
    expect(approvalFiring.resolution).toBe("approved");
    // Allow_notify firing has resolution="allow_notify"
    const notifyFiring = body.firings.find(
      (f: { resolution: string }) => f.resolution === "allow_notify",
    );
    expect(notifyFiring).toBeDefined();
  });

  it("respects ?limit=", async () => {
    const r = mkRule({ id: "gr_lim" });
    store.add(r);
    const now = Date.now();
    const audit: AuditEntry[] = [];
    for (let i = 0; i < 5; i++) {
      audit.push(
        gMatchEntry({
          guardrailId: "gr_lim",
          timestamp: new Date(now - i * 60_000).toISOString(),
          toolCallId: `tc_${i}`,
          action: "block",
        }),
      );
    }
    registerDashboardRoutes(api, {
      auditLogger: buildLogger(audit),
      guardrailStore: store,
    });
    const { res, out } = makeRes();
    await getHandler()(makeReq("/plugins/clawlens/api/guardrails/gr_lim/firings?limit=2"), res);
    expect(out.status).toBe(200);
    expect(JSON.parse(out.body).firings).toHaveLength(2);
  });
});

// ── Storage-error mapping (parity with saved-searches) ────────

describe("Guardrail routes — storage errors map to 507", () => {
  let api: OpenClawPluginApi;
  let getHandler: () => HttpRouteHandler;
  let cleanupStore: () => void;
  let store: GuardrailStore;
  let storeFile: string;

  beforeEach(() => {
    const made = makeApi();
    api = made.api;
    getHandler = made.handler;
    const t = tmpGuardrails();
    store = t.store;
    cleanupStore = t.cleanup;
    storeFile = t.file;
    registerDashboardRoutes(api, {
      auditLogger: buildLogger([]),
      guardrailStore: store,
    });
  });

  afterEach(() => {
    cleanupStore();
  });

  function postBody(body: unknown) {
    const r = makeRes();
    return getHandler()(
      makeReq("/plugins/clawlens/api/guardrails", { method: "POST", body }),
      r.res,
    ).then(() => r.out);
  }

  const validBody = {
    selector: { agent: null, tools: { mode: "names", values: ["exec"] } },
    target: { kind: "identity-glob", pattern: "x" },
    action: "block",
    source: { toolCallId: "tc_507", sessionKey: "s_1", agentId: "alpha" },
    riskScore: 0,
  };

  it("POST /api/guardrails returns 507 when save throws EISDIR", async () => {
    fs.mkdirSync(`${storeFile}.tmp`);
    try {
      const out = await postBody(validBody);
      expect(out.status).toBe(507);
      const body = JSON.parse(out.body);
      expect(body.error).toMatch(/disk|storage|space|unwritable/i);
      expect(body.code).toBe("EISDIR");
    } finally {
      fs.rmdirSync(`${storeFile}.tmp`);
    }
    expect(store.list()).toHaveLength(0);
  });

  it("PATCH returns 507 on disk failure and rolls back", async () => {
    const out1 = await postBody(validBody);
    expect(out1.status).toBe(200);
    const id = JSON.parse(out1.body).id;
    expect(store.list()[0].action).toBe("block");

    fs.mkdirSync(`${storeFile}.tmp`);
    try {
      const r = makeRes();
      await getHandler()(
        makeReq(`/plugins/clawlens/api/guardrails/${id}`, {
          method: "PATCH",
          body: { action: "require_approval" },
        }),
        r.res,
      );
      expect(r.out.status).toBe(507);
    } finally {
      fs.rmdirSync(`${storeFile}.tmp`);
    }
    expect(store.list()[0].action).toBe("block");
  });

  it("DELETE returns 507 on disk failure and entry stays present", async () => {
    const out1 = await postBody(validBody);
    const id = JSON.parse(out1.body).id;
    expect(store.list()).toHaveLength(1);

    fs.mkdirSync(`${storeFile}.tmp`);
    try {
      const r = makeRes();
      await getHandler()(
        makeReq(`/plugins/clawlens/api/guardrails/${id}`, { method: "DELETE" }),
        r.res,
      );
      expect(r.out.status).toBe(507);
    } finally {
      fs.rmdirSync(`${storeFile}.tmp`);
    }
    expect(store.list()).toHaveLength(1);
  });
});
