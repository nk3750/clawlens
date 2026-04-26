import * as fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditEntry, AuditLogger } from "../src/audit/logger";
import { registerDashboardRoutes } from "../src/dashboard/routes";
import { GuardrailStore } from "../src/guardrails/store";
import type { HttpRouteHandler, HttpRouteParams, OpenClawPluginApi } from "../src/types";

/**
 * Boilerplate mirrors tests/attention-routes.test.ts: lightweight fakes for
 * IncomingMessage / ServerResponse / OpenClawPluginApi so registerDashboardRoutes
 * exercises the real route logic against an in-process GuardrailStore.
 */

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
    // biome-ignore lint/suspicious/noExplicitAny: minimal AuditLogger shape for the handler
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

function tmpGuardrails(): { store: GuardrailStore; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawlens-gr-routes-"));
  const file = path.join(dir, "guardrails.json");
  const store = new GuardrailStore(file);
  store.load();
  return {
    store,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

describe("POST /api/guardrails — idempotency", () => {
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
    const entries: AuditEntry[] = [
      entry({
        toolCallId: "tc_curl",
        agentId: "alpha",
        params: { command: "curl https://evil.com" },
      }),
    ];
    registerDashboardRoutes(api, {
      auditLogger: buildLogger(entries),
      guardrailStore: store,
    });
  });

  afterEach(() => {
    cleanupStore();
  });

  it("first POST creates a guardrail and returns existing:false", async () => {
    const { res, out } = makeRes();
    await getHandler()(
      makeReq("/plugins/clawlens/api/guardrails", {
        method: "POST",
        body: { toolCallId: "tc_curl", action: { type: "block" }, agentScope: "agent" },
      }),
      res,
    );
    expect(out.status).toBe(200);
    const body = JSON.parse(out.body);
    expect(body.existing).toBe(false);
    expect(body.id).toMatch(/^gr_/);
    expect(body.tool).toBe("exec");
    expect(body.identityKey).toBe("curl https://evil.com");
    expect(body.agentId).toBe("alpha");
    expect(store.list()).toHaveLength(1);
  });

  it("second POST with identical (toolCallId, action, agentScope) returns existing:true and does not duplicate", async () => {
    // First create.
    const r1 = makeRes();
    await getHandler()(
      makeReq("/plugins/clawlens/api/guardrails", {
        method: "POST",
        body: { toolCallId: "tc_curl", action: { type: "block" }, agentScope: "agent" },
      }),
      r1.res,
    );
    expect(JSON.parse(r1.out.body).existing).toBe(false);
    expect(store.list()).toHaveLength(1);
    const firstId = JSON.parse(r1.out.body).id;

    // Second create — same scope should be a no-op returning existing:true
    // and re-surfacing the original guardrail's id.
    const r2 = makeRes();
    await getHandler()(
      makeReq("/plugins/clawlens/api/guardrails", {
        method: "POST",
        body: { toolCallId: "tc_curl", action: { type: "block" }, agentScope: "agent" },
      }),
      r2.res,
    );
    expect(r2.out.status).toBe(200);
    const body = JSON.parse(r2.out.body);
    expect(body.existing).toBe(true);
    expect(body.id).toBe(firstId);
    expect(store.list()).toHaveLength(1);
  });

  it("agent-scope create followed by global-scope create are NOT idempotent (different key tuples)", async () => {
    const r1 = makeRes();
    await getHandler()(
      makeReq("/plugins/clawlens/api/guardrails", {
        method: "POST",
        body: { toolCallId: "tc_curl", action: { type: "block" }, agentScope: "agent" },
      }),
      r1.res,
    );
    expect(JSON.parse(r1.out.body).existing).toBe(false);

    const r2 = makeRes();
    await getHandler()(
      makeReq("/plugins/clawlens/api/guardrails", {
        method: "POST",
        body: { toolCallId: "tc_curl", action: { type: "block" }, agentScope: "global" },
      }),
      r2.res,
    );
    expect(r2.out.status).toBe(200);
    const body = JSON.parse(r2.out.body);
    expect(body.existing).toBe(false);
    expect(body.agentId).toBeNull();
    expect(store.list()).toHaveLength(2);
  });

  it("idempotency is keyed on (agent, tool, identityKey) — different action on the same key still returns existing:true (last writer does NOT win)", async () => {
    // Rationale: idempotency prevents accidental dupes when the operator
    // double-clicks. If they want to change the action, they should edit
    // the existing guardrail, not create a new one. Today's behavior:
    // returns the original guardrail untouched.
    const r1 = makeRes();
    await getHandler()(
      makeReq("/plugins/clawlens/api/guardrails", {
        method: "POST",
        body: { toolCallId: "tc_curl", action: { type: "block" }, agentScope: "agent" },
      }),
      r1.res,
    );
    const firstId = JSON.parse(r1.out.body).id;
    expect(store.list()[0].action.type).toBe("block");

    const r2 = makeRes();
    await getHandler()(
      makeReq("/plugins/clawlens/api/guardrails", {
        method: "POST",
        body: { toolCallId: "tc_curl", action: { type: "require_approval" }, agentScope: "agent" },
      }),
      r2.res,
    );
    const body = JSON.parse(r2.out.body);
    expect(body.existing).toBe(true);
    expect(body.id).toBe(firstId);
    // Original action unchanged.
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0].action.type).toBe("block");
  });
});

// ── Storage-error mapping (parity with saved-searches) ────────────────
// SavedSearchesStore route handlers wrap mutations in handleStorageError so
// disk-shaped errors (ENOSPC, EISDIR, EROFS, EDQUOT) surface as 507 instead
// of an uncaught throw → bare 5xx. These tests provoke a real EISDIR by
// pre-creating a directory at the .tmp write path; the rollback semantics
// from a61a477 ensure list state is unchanged regardless, but the operator-
// facing error is the parity goal.

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

    // Inline a tmpGuardrails-equivalent so we can capture the file path —
    // the helper used by the suite above hides it. Same pattern, same
    // cleanup contract.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawlens-gr-507-"));
    storeFile = path.join(dir, "guardrails.json");
    store = new GuardrailStore(storeFile);
    store.load();
    cleanupStore = () => fs.rmSync(dir, { recursive: true, force: true });

    const entries: AuditEntry[] = [
      entry({
        toolCallId: "tc_507",
        agentId: "alpha",
        params: { command: "curl https://evil.com" },
      }),
    ];
    registerDashboardRoutes(api, {
      auditLogger: buildLogger(entries),
      guardrailStore: store,
    });
  });

  afterEach(() => {
    cleanupStore();
  });

  it("POST /api/guardrails returns 507 when the underlying save throws a disk-shaped error", async () => {
    fs.mkdirSync(`${storeFile}.tmp`); // forces EISDIR on writeFileSync
    try {
      const { res, out } = makeRes();
      await getHandler()(
        makeReq("/plugins/clawlens/api/guardrails", {
          method: "POST",
          body: { toolCallId: "tc_507", action: { type: "block" }, agentScope: "agent" },
        }),
        res,
      );
      expect(out.status).toBe(507);
      const body = JSON.parse(out.body);
      expect(body.error).toMatch(/disk|storage|space|unwritable/i);
      expect(body.code).toBe("EISDIR");
    } finally {
      fs.rmdirSync(`${storeFile}.tmp`);
    }
    // Rollback (a61a477) keeps the store empty.
    expect(store.list()).toHaveLength(0);
  });

  it("PUT /api/guardrails/:id returns 507 on disk failure and the action is rolled back", async () => {
    // Seed one guardrail so we can target it for an update.
    const r1 = makeRes();
    await getHandler()(
      makeReq("/plugins/clawlens/api/guardrails", {
        method: "POST",
        body: { toolCallId: "tc_507", action: { type: "block" }, agentScope: "agent" },
      }),
      r1.res,
    );
    expect(r1.out.status).toBe(200);
    const id = JSON.parse(r1.out.body).id;
    expect(store.list()[0].action.type).toBe("block");

    fs.mkdirSync(`${storeFile}.tmp`);
    try {
      const { res, out } = makeRes();
      await getHandler()(
        makeReq(`/plugins/clawlens/api/guardrails/${id}`, {
          method: "PUT",
          body: { action: { type: "require_approval" } },
        }),
        res,
      );
      expect(out.status).toBe(507);
      const body = JSON.parse(out.body);
      expect(body.error).toMatch(/disk|storage|space|unwritable/i);
      expect(body.code).toBe("EISDIR");
    } finally {
      fs.rmdirSync(`${storeFile}.tmp`);
    }
    // Rollback (a61a477) restores the original action.
    expect(store.list()[0].action.type).toBe("block");
  });

  it("DELETE /api/guardrails/:id returns 507 on disk failure and the entry stays present", async () => {
    const r1 = makeRes();
    await getHandler()(
      makeReq("/plugins/clawlens/api/guardrails", {
        method: "POST",
        body: { toolCallId: "tc_507", action: { type: "block" }, agentScope: "agent" },
      }),
      r1.res,
    );
    const id = JSON.parse(r1.out.body).id;
    expect(store.list()).toHaveLength(1);

    fs.mkdirSync(`${storeFile}.tmp`);
    try {
      const { res, out } = makeRes();
      await getHandler()(
        makeReq(`/plugins/clawlens/api/guardrails/${id}`, { method: "DELETE" }),
        res,
      );
      expect(out.status).toBe(507);
      const body = JSON.parse(out.body);
      expect(body.error).toMatch(/disk|storage|space|unwritable/i);
      expect(body.code).toBe("EISDIR");
    } finally {
      fs.rmdirSync(`${storeFile}.tmp`);
    }
    // Rollback (a61a477) keeps the entry present.
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0].id).toBe(id);
  });
});
