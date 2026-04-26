import * as fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditLogger } from "../src/audit/logger";
import { registerDashboardRoutes } from "../src/dashboard/routes";
import { SavedSearchesStore } from "../src/risk/saved-searches-store";
import type { HttpRouteHandler, HttpRouteParams, OpenClawPluginApi } from "../src/types";

// Test harness mirrors tests/guardrails-create-api.test.ts: in-process API
// fakes + a real SavedSearchesStore on a temp file so we exercise the full
// route handler against real persistence.

function buildLogger(): AuditLogger {
  return {
    readEntries: () => [],
    readEntriesRaw: () => [],
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

let tmpDir: string;
let storeFile: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawlens-saved-routes-"));
  storeFile = path.join(tmpDir, "activity-saved-searches.json");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function setup() {
  const made = makeApi();
  const store = new SavedSearchesStore(storeFile);
  store.load();
  registerDashboardRoutes(made.api, {
    auditLogger: buildLogger(),
    savedSearchesStore: store,
  });
  return { handler: made.handler(), store };
}

describe("GET /api/saved-searches", () => {
  it("returns { items: [] } when the store is empty", async () => {
    const { handler } = setup();
    const { res, out } = makeRes();
    await handler(makeReq("/plugins/clawlens/api/saved-searches"), res);
    expect(out.status).toBe(200);
    expect(JSON.parse(out.body)).toEqual({ items: [] });
  });

  it("returns the items currently in the store after a POST", async () => {
    const { handler, store } = setup();
    store.add("seeded", { tier: "high" });

    const { res, out } = makeRes();
    await handler(makeReq("/plugins/clawlens/api/saved-searches"), res);
    expect(out.status).toBe(200);
    const body = JSON.parse(out.body);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].name).toBe("seeded");
    expect(body.items[0].id).toMatch(/^ss_/);
  });

  it("returns 501 when no savedSearchesStore is configured", async () => {
    // Re-register with deps that omit savedSearchesStore — mirrors the
    // guardrails 501 contract for misconfigured installs.
    const made = makeApi();
    registerDashboardRoutes(made.api, { auditLogger: buildLogger() });
    const { res, out } = makeRes();
    await made.handler()(makeReq("/plugins/clawlens/api/saved-searches"), res);
    expect(out.status).toBe(501);
    expect(JSON.parse(out.body).error).toMatch(/saved searches/i);
  });
});

describe("POST /api/saved-searches", () => {
  it("creates an entry and returns { item: SavedSearch } with generated id + ISO createdAt", async () => {
    const { handler, store } = setup();
    const { res, out } = makeRes();
    await handler(
      makeReq("/plugins/clawlens/api/saved-searches", {
        method: "POST",
        body: { name: "blocks today", filters: { tier: "high", decision: "block" } },
      }),
      res,
    );
    expect(out.status).toBe(200);
    const body = JSON.parse(out.body);
    expect(body.item.id).toMatch(/^ss_[0-9a-f]{12}$/);
    expect(body.item.name).toBe("blocks today");
    expect(body.item.filters).toEqual({ tier: "high", decision: "block" });
    expect(new Date(body.item.createdAt).toISOString()).toBe(body.item.createdAt);
    expect(store.list()).toHaveLength(1);
  });

  it("rejects an empty name with 400", async () => {
    const { handler, store } = setup();
    const { res, out } = makeRes();
    await handler(
      makeReq("/plugins/clawlens/api/saved-searches", {
        method: "POST",
        body: { name: "", filters: { tier: "high" } },
      }),
      res,
    );
    expect(out.status).toBe(400);
    expect(JSON.parse(out.body).error).toMatch(/name/i);
    expect(store.list()).toEqual([]);
  });

  it("rejects a whitespace-only name with 400", async () => {
    const { handler, store } = setup();
    const { res, out } = makeRes();
    await handler(
      makeReq("/plugins/clawlens/api/saved-searches", {
        method: "POST",
        body: { name: "   ", filters: { tier: "high" } },
      }),
      res,
    );
    expect(out.status).toBe(400);
    expect(store.list()).toEqual([]);
  });

  it("rejects a name longer than 100 chars with 400 (defense-in-depth)", async () => {
    const { handler, store } = setup();
    const { res, out } = makeRes();
    await handler(
      makeReq("/plugins/clawlens/api/saved-searches", {
        method: "POST",
        body: { name: "a".repeat(101), filters: {} },
      }),
      res,
    );
    expect(out.status).toBe(400);
    expect(JSON.parse(out.body).error).toMatch(/100/);
    expect(store.list()).toEqual([]);
  });

  it("accepts a name of exactly 100 chars (boundary)", async () => {
    const { handler, store } = setup();
    const { res, out } = makeRes();
    await handler(
      makeReq("/plugins/clawlens/api/saved-searches", {
        method: "POST",
        body: { name: "a".repeat(100), filters: {} },
      }),
      res,
    );
    expect(out.status).toBe(200);
    expect(store.list()).toHaveLength(1);
  });

  it("returns 501 when no savedSearchesStore is configured", async () => {
    const made = makeApi();
    registerDashboardRoutes(made.api, { auditLogger: buildLogger() });
    const { res, out } = makeRes();
    await made.handler()(
      makeReq("/plugins/clawlens/api/saved-searches", {
        method: "POST",
        body: { name: "x", filters: {} },
      }),
      res,
    );
    expect(out.status).toBe(501);
  });

  it("returns 507 (Insufficient Storage) when the underlying save throws a disk-full-shaped error", async () => {
    const { handler, store } = setup();
    // Provoke EISDIR — a real disk error — by pre-creating the temp-write
    // path as a directory. Maps to the same failure surface as ENOSPC.
    fs.mkdirSync(`${storeFile}.tmp`);
    try {
      const { res, out } = makeRes();
      await handler(
        makeReq("/plugins/clawlens/api/saved-searches", {
          method: "POST",
          body: { name: "x", filters: {} },
        }),
        res,
      );
      expect(out.status).toBe(507);
      expect(JSON.parse(out.body).error).toMatch(/disk|storage|space/i);
    } finally {
      fs.rmdirSync(`${storeFile}.tmp`);
    }
    // The failed POST must not have leaked into the store.
    expect(store.list()).toEqual([]);
  });

  it("two POSTs with the same name persist as distinct entries", async () => {
    const { handler, store } = setup();
    for (const _ of [1, 2]) {
      const { res } = makeRes();
      await handler(
        makeReq("/plugins/clawlens/api/saved-searches", {
          method: "POST",
          body: { name: "dup", filters: { tier: "high" } },
        }),
        res,
      );
    }
    expect(store.list()).toHaveLength(2);
    expect(store.list()[0].id).not.toBe(store.list()[1].id);
  });
});

describe("DELETE /api/saved-searches/:id", () => {
  it("removes the entry by id and returns { ok: true }", async () => {
    const { handler, store } = setup();
    const item = store.add("a", { tier: "high" });

    const { res, out } = makeRes();
    await handler(
      makeReq(`/plugins/clawlens/api/saved-searches/${item.id}`, { method: "DELETE" }),
      res,
    );
    expect(out.status).toBe(200);
    expect(JSON.parse(out.body)).toEqual({ ok: true });
    expect(store.list()).toEqual([]);
  });

  it("returns 404 when the id does not exist", async () => {
    const { handler } = setup();
    const { res, out } = makeRes();
    await handler(
      makeReq("/plugins/clawlens/api/saved-searches/ss_nope", { method: "DELETE" }),
      res,
    );
    expect(out.status).toBe(404);
  });

  it("decodes URL-encoded ids before lookup", async () => {
    const { handler, store } = setup();
    const item = store.add("a", { tier: "high" });
    const { res, out } = makeRes();
    await handler(
      makeReq(`/plugins/clawlens/api/saved-searches/${encodeURIComponent(item.id)}`, {
        method: "DELETE",
      }),
      res,
    );
    expect(out.status).toBe(200);
    expect(store.list()).toEqual([]);
  });

  it("returns 501 when no savedSearchesStore is configured", async () => {
    const made = makeApi();
    registerDashboardRoutes(made.api, { auditLogger: buildLogger() });
    const { res, out } = makeRes();
    await made.handler()(
      makeReq("/plugins/clawlens/api/saved-searches/ss_x", { method: "DELETE" }),
      res,
    );
    expect(out.status).toBe(501);
  });
});

describe("PATCH /api/saved-searches/:id", () => {
  it("renames the entry and returns { item: SavedSearch }", async () => {
    const { handler, store } = setup();
    const original = store.add("old", { tier: "high" });

    const { res, out } = makeRes();
    await handler(
      makeReq(`/plugins/clawlens/api/saved-searches/${original.id}`, {
        method: "PATCH",
        body: { name: "new" },
      }),
      res,
    );
    expect(out.status).toBe(200);
    const body = JSON.parse(out.body);
    expect(body.item.id).toBe(original.id);
    expect(body.item.name).toBe("new");
    expect(body.item.filters).toEqual({ tier: "high" });
    expect(body.item.createdAt).toBe(original.createdAt);
    expect(store.list()[0].name).toBe("new");
  });

  it("returns 404 when the id does not exist", async () => {
    const { handler } = setup();
    const { res, out } = makeRes();
    await handler(
      makeReq("/plugins/clawlens/api/saved-searches/ss_nope", {
        method: "PATCH",
        body: { name: "new" },
      }),
      res,
    );
    expect(out.status).toBe(404);
  });

  it("rejects an empty name with 400", async () => {
    const { handler, store } = setup();
    const original = store.add("old", { tier: "high" });
    const { res, out } = makeRes();
    await handler(
      makeReq(`/plugins/clawlens/api/saved-searches/${original.id}`, {
        method: "PATCH",
        body: { name: "" },
      }),
      res,
    );
    expect(out.status).toBe(400);
    expect(store.list()[0].name).toBe("old");
  });

  it("rejects a whitespace-only name with 400", async () => {
    const { handler, store } = setup();
    const original = store.add("old", { tier: "high" });
    const { res, out } = makeRes();
    await handler(
      makeReq(`/plugins/clawlens/api/saved-searches/${original.id}`, {
        method: "PATCH",
        body: { name: "   " },
      }),
      res,
    );
    expect(out.status).toBe(400);
    expect(store.list()[0].name).toBe("old");
  });

  it("rejects a name longer than 100 chars with 400", async () => {
    const { handler, store } = setup();
    const original = store.add("old", { tier: "high" });
    const { res, out } = makeRes();
    await handler(
      makeReq(`/plugins/clawlens/api/saved-searches/${original.id}`, {
        method: "PATCH",
        body: { name: "a".repeat(101) },
      }),
      res,
    );
    expect(out.status).toBe(400);
    expect(store.list()[0].name).toBe("old");
  });

  it("returns 501 when no savedSearchesStore is configured", async () => {
    const made = makeApi();
    registerDashboardRoutes(made.api, { auditLogger: buildLogger() });
    const { res, out } = makeRes();
    await made.handler()(
      makeReq("/plugins/clawlens/api/saved-searches/ss_x", {
        method: "PATCH",
        body: { name: "y" },
      }),
      res,
    );
    expect(out.status).toBe(501);
  });
});

describe("saved-searches routes — round-trip", () => {
  it("POST → GET → DELETE → GET reflects each step", async () => {
    const { handler } = setup();

    const post = makeRes();
    await handler(
      makeReq("/plugins/clawlens/api/saved-searches", {
        method: "POST",
        body: { name: "rt", filters: { agent: "alpha" } },
      }),
      post.res,
    );
    const id = JSON.parse(post.out.body).item.id;

    const get1 = makeRes();
    await handler(makeReq("/plugins/clawlens/api/saved-searches"), get1.res);
    expect(JSON.parse(get1.out.body).items).toHaveLength(1);

    const del = makeRes();
    await handler(
      makeReq(`/plugins/clawlens/api/saved-searches/${id}`, { method: "DELETE" }),
      del.res,
    );
    expect(JSON.parse(del.out.body)).toEqual({ ok: true });

    const get2 = makeRes();
    await handler(makeReq("/plugins/clawlens/api/saved-searches"), get2.res);
    expect(JSON.parse(get2.out.body).items).toEqual([]);
  });
});
