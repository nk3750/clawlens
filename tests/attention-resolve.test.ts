import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditEntry, AuditLogger } from "../src/audit/logger";
import { registerDashboardRoutes } from "../src/dashboard/routes";
import type { PendingApproval, PendingApprovalStore } from "../src/hooks/pending-approval-store";
import type { HttpRouteHandler, HttpRouteParams, OpenClawPluginApi } from "../src/types";

function buildLogger(entries: AuditEntry[] = []): AuditLogger {
  return {
    readEntries: () => entries,
    readEntriesRaw: () => entries,
    logApprovalResolution: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    // biome-ignore lint/suspicious/noExplicitAny: minimal AuditLogger shape
  } as any;
}

function buildStore(
  overrides: Partial<Record<keyof PendingApprovalStore, unknown>> = {},
): PendingApprovalStore {
  return {
    put: vi.fn(),
    take: vi.fn(),
    peek: vi.fn(),
    size: vi.fn().mockReturnValue(0),
    shutdown: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    ...overrides,
    // biome-ignore lint/suspicious/noExplicitAny: minimal store shape for handler tests
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

function stash(overrides: Partial<PendingApproval> = {}): PendingApproval {
  return {
    toolCallId: "tc_1",
    agentId: "alpha",
    toolName: "exec",
    stashedAt: Date.now(),
    timeoutMs: 300_000,
    resolve: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("POST /api/attention/resolve", () => {
  let auditLogger: AuditLogger;

  beforeEach(() => {
    auditLogger = buildLogger();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns 200 and fires resolver + audit decoration on a valid approve", async () => {
    const entry = stash({ toolCallId: "tc_42", toolName: "exec", agentId: "alpha" });
    const take = vi.fn().mockReturnValue(entry);
    const store = buildStore({ take });
    const { api, handler } = makeApi();
    registerDashboardRoutes(api, { auditLogger, pendingApprovalStore: store });

    const { res, out } = makeRes();
    await handler()(
      makeReq("/plugins/clawlens/api/attention/resolve", {
        method: "POST",
        body: { toolCallId: "tc_42", decision: "approve", note: "verified" },
      }),
      res,
    );

    expect(out.status).toBe(200);
    const body = JSON.parse(out.body);
    expect(body.ok).toBe(true);
    expect(body.decision).toBe("approve");
    expect(body.resolvedAt).toBeDefined();

    // Resolver invoked with the OpenClaw-native "allow-once" verb (not "approve").
    expect(entry.resolve).toHaveBeenCalledWith("allow-once");

    // Audit decoration carries dashboard provenance.
    expect(auditLogger.logApprovalResolution).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: "tc_42",
        toolName: "exec",
        approved: true,
        resolvedBy: "dashboard",
        note: "verified",
        agentId: "alpha",
      }),
    );
  });

  it("translates decision='deny' into resolver 'deny' verb", async () => {
    const entry = stash({ toolCallId: "tc_43" });
    const store = buildStore({ take: vi.fn().mockReturnValue(entry) });
    const { api, handler } = makeApi();
    registerDashboardRoutes(api, { auditLogger, pendingApprovalStore: store });

    const { res, out } = makeRes();
    await handler()(
      makeReq("/plugins/clawlens/api/attention/resolve", {
        method: "POST",
        body: { toolCallId: "tc_43", decision: "deny" },
      }),
      res,
    );

    expect(out.status).toBe(200);
    expect(entry.resolve).toHaveBeenCalledWith("deny");
    expect(auditLogger.logApprovalResolution).toHaveBeenCalledWith(
      expect.objectContaining({ approved: false, resolvedBy: "dashboard" }),
    );
  });

  it("returns 400 when toolCallId is missing", async () => {
    const store = buildStore();
    const { api, handler } = makeApi();
    registerDashboardRoutes(api, { auditLogger, pendingApprovalStore: store });

    const { res, out } = makeRes();
    await handler()(
      makeReq("/plugins/clawlens/api/attention/resolve", {
        method: "POST",
        body: { decision: "approve" },
      }),
      res,
    );

    expect(out.status).toBe(400);
    expect(JSON.parse(out.body).error).toBe("Invalid body");
    expect(store.take).not.toHaveBeenCalled();
  });

  it("returns 400 when decision is not approve/deny", async () => {
    const store = buildStore();
    const { api, handler } = makeApi();
    registerDashboardRoutes(api, { auditLogger, pendingApprovalStore: store });

    const { res, out } = makeRes();
    await handler()(
      makeReq("/plugins/clawlens/api/attention/resolve", {
        method: "POST",
        body: { toolCallId: "tc_x", decision: "maybe" },
      }),
      res,
    );

    expect(out.status).toBe(400);
    expect(store.take).not.toHaveBeenCalled();
  });

  it("returns 400 when toolCallId is an empty string", async () => {
    const store = buildStore();
    const { api, handler } = makeApi();
    registerDashboardRoutes(api, { auditLogger, pendingApprovalStore: store });

    const { res, out } = makeRes();
    await handler()(
      makeReq("/plugins/clawlens/api/attention/resolve", {
        method: "POST",
        body: { toolCallId: "", decision: "approve" },
      }),
      res,
    );

    expect(out.status).toBe(400);
    expect(store.take).not.toHaveBeenCalled();
  });

  it("returns 404 with reason=already_resolved when take() returns undefined", async () => {
    const store = buildStore({ take: vi.fn().mockReturnValue(undefined) });
    const { api, handler } = makeApi();
    registerDashboardRoutes(api, { auditLogger, pendingApprovalStore: store });

    const { res, out } = makeRes();
    await handler()(
      makeReq("/plugins/clawlens/api/attention/resolve", {
        method: "POST",
        body: { toolCallId: "tc_gone", decision: "approve" },
      }),
      res,
    );

    expect(out.status).toBe(404);
    const body = JSON.parse(out.body);
    expect(body.error).toBe("Already resolved");
    expect(body.reason).toBe("already_resolved");
    expect(auditLogger.logApprovalResolution).not.toHaveBeenCalled();
  });

  it("returns 501 when pendingApprovalStore is not configured", async () => {
    const { api, handler } = makeApi();
    registerDashboardRoutes(api, { auditLogger });

    const { res, out } = makeRes();
    await handler()(
      makeReq("/plugins/clawlens/api/attention/resolve", {
        method: "POST",
        body: { toolCallId: "tc_x", decision: "approve" },
      }),
      res,
    );

    expect(out.status).toBe(501);
    expect(JSON.parse(out.body).error).toContain("Approval store not configured");
  });

  it("returns 500 when the resolver throws", async () => {
    const entry = stash({
      toolCallId: "tc_boom",
      resolve: vi.fn().mockRejectedValue(new Error("OpenClaw blew up")),
    });
    const store = buildStore({ take: vi.fn().mockReturnValue(entry) });
    const { api, handler } = makeApi();
    registerDashboardRoutes(api, { auditLogger, pendingApprovalStore: store });

    const { res, out } = makeRes();
    await handler()(
      makeReq("/plugins/clawlens/api/attention/resolve", {
        method: "POST",
        body: { toolCallId: "tc_boom", decision: "approve" },
      }),
      res,
    );

    expect(out.status).toBe(500);
    const body = JSON.parse(out.body);
    expect(body.error).toBe("Resolver threw");
    expect(body.message).toContain("OpenClaw blew up");
    // Audit decoration must NOT fire — the resolution attempt failed.
    expect(auditLogger.logApprovalResolution).not.toHaveBeenCalled();
  });
});
