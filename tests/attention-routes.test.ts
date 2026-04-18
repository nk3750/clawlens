import * as fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditEntry, AuditLogger } from "../src/audit/logger";
import { AttentionStore } from "../src/dashboard/attention-state";
import { registerDashboardRoutes } from "../src/dashboard/routes";
import type { HttpRouteHandler, HttpRouteParams, OpenClawPluginApi } from "../src/types";

/** Minimal AuditEntry factory — mirrors dashboard-v2-api.test.ts. */
function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    timestamp: new Date().toISOString(),
    toolName: "exec",
    params: {},
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
      // Fire body chunks immediately so readBody() resolves in the handler.
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

function tmpStore(): { store: AttentionStore; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawlens-routes-"));
  const file = path.join(dir, "attention.jsonl");
  return {
    store: new AttentionStore(file),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

describe("GET /api/attention", () => {
  let api: OpenClawPluginApi;
  let getHandler: () => HttpRouteHandler;
  let cleanupStore: () => void;
  let store: AttentionStore;
  const NOW_ISO = "2026-04-17T12:00:00.000Z";
  const NOW_MS = new Date(NOW_ISO).getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_ISO));
    const made = makeApi();
    api = made.api;
    getHandler = made.handler;
    const t = tmpStore();
    store = t.store;
    cleanupStore = t.cleanup;
    const entries: AuditEntry[] = [
      entry({
        timestamp: new Date(NOW_MS - 60 * 60_000).toISOString(),
        decision: "block",
        agentId: "alpha",
        toolCallId: "tc_blocked",
      }),
      entry({
        timestamp: new Date(NOW_MS - 5 * 60_000).toISOString(),
        decision: "allow",
        agentId: "beta",
        toolCallId: "tc_hr",
        riskScore: 80,
      }),
    ];
    registerDashboardRoutes(api, {
      auditLogger: buildLogger(entries),
      attentionStore: store,
    });
  });

  afterEach(() => {
    cleanupStore();
    vi.useRealTimers();
  });

  it("returns 200 with the AttentionResponse shape", async () => {
    const { res, out } = makeRes();
    await getHandler()(makeReq("/plugins/clawlens/api/attention"), res);
    expect(out.status).toBe(200);
    const body = JSON.parse(out.body);
    expect(body.pending).toEqual([]);
    expect(Array.isArray(body.blocked)).toBe(true);
    expect(Array.isArray(body.agentAttention)).toBe(true);
    expect(Array.isArray(body.highRisk)).toBe(true);
    expect(body.blocked).toHaveLength(1);
    expect(body.blocked[0].toolCallId).toBe("tc_blocked");
    expect(body.highRisk).toHaveLength(1);
    expect(body.highRisk[0].toolCallId).toBe("tc_hr");
  });

  it("reflects a freshly-written ack in the next GET (read-your-own-writes)", async () => {
    // Directly write a dismiss record — the sync append must make it visible
    // to the very next GET /api/attention in the same tick.
    store.append({
      id: AttentionStore.generateId(),
      scope: { kind: "entry", toolCallId: "tc_blocked" },
      ackedAt: NOW_ISO,
      action: "dismiss",
    });
    const { res, out } = makeRes();
    await getHandler()(makeReq("/plugins/clawlens/api/attention"), res);
    const body = JSON.parse(out.body);
    expect(body.blocked.map((b: { toolCallId: string }) => b.toolCallId)).not.toContain(
      "tc_blocked",
    );
  });
});

describe("POST /api/attention/ack + /dismiss", () => {
  let api: OpenClawPluginApi;
  let getHandler: () => HttpRouteHandler;
  let cleanupStore: () => void;
  let store: AttentionStore;

  beforeEach(() => {
    const made = makeApi();
    api = made.api;
    getHandler = made.handler;
    const t = tmpStore();
    store = t.store;
    cleanupStore = t.cleanup;
    registerDashboardRoutes(api, {
      auditLogger: buildLogger([]),
      attentionStore: store,
    });
  });

  afterEach(() => {
    cleanupStore();
  });

  it("accepts a valid entry-scoped ack and persists it to the store", async () => {
    const { res, out } = makeRes();
    await getHandler()(
      makeReq("/plugins/clawlens/api/attention/ack", {
        method: "POST",
        body: { scope: { kind: "entry", toolCallId: "tc_42" }, note: "looked at this" },
      }),
      res,
    );
    expect(out.status).toBe(200);
    const body = JSON.parse(out.body);
    expect(body.ok).toBe(true);
    expect(body.id).toMatch(/^ack_/);
    expect(body.ackedAt).toBeDefined();

    const persisted = store.isAckedEntry("tc_42");
    expect(persisted?.action).toBe("ack");
    expect(persisted?.note).toBe("looked at this");
  });

  it("accepts a valid agent-scoped dismiss", async () => {
    const upToIso = "2026-04-17T12:00:00.000Z";
    const { res, out } = makeRes();
    await getHandler()(
      makeReq("/plugins/clawlens/api/attention/dismiss", {
        method: "POST",
        body: { scope: { kind: "agent", agentId: "alpha", upToIso } },
      }),
      res,
    );
    expect(out.status).toBe(200);
    const persisted = store.isAckedAgent("alpha", upToIso);
    expect(persisted?.action).toBe("dismiss");
  });

  it("returns 400 when the scope is missing", async () => {
    const { res, out } = makeRes();
    await getHandler()(
      makeReq("/plugins/clawlens/api/attention/ack", {
        method: "POST",
        body: { note: "forgot the scope" },
      }),
      res,
    );
    expect(out.status).toBe(400);
    expect(JSON.parse(out.body).error).toContain("scope");
  });

  it("returns 400 when the scope shape is wrong (empty toolCallId)", async () => {
    const { res, out } = makeRes();
    await getHandler()(
      makeReq("/plugins/clawlens/api/attention/ack", {
        method: "POST",
        body: { scope: { kind: "entry", toolCallId: "" } },
      }),
      res,
    );
    expect(out.status).toBe(400);
  });

  it("returns 400 when the agent scope has an unparseable upToIso", async () => {
    const { res, out } = makeRes();
    await getHandler()(
      makeReq("/plugins/clawlens/api/attention/dismiss", {
        method: "POST",
        body: { scope: { kind: "agent", agentId: "alpha", upToIso: "not-a-date" } },
      }),
      res,
    );
    expect(out.status).toBe(400);
  });

  it("returns 501 when the attention store is not configured", async () => {
    const made = makeApi();
    // Deliberately omit attentionStore.
    registerDashboardRoutes(made.api, { auditLogger: buildLogger([]) });

    const { res, out } = makeRes();
    await made.handler()(
      makeReq("/plugins/clawlens/api/attention/ack", {
        method: "POST",
        body: { scope: { kind: "entry", toolCallId: "tc_x" } },
      }),
      res,
    );
    expect(out.status).toBe(501);
  });
});
