import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { AuditEntry, AuditLogger } from "../src/audit/logger";
import { registerDashboardRoutes } from "../src/dashboard/routes";
import type { HttpRouteHandler, HttpRouteParams, OpenClawPluginApi } from "../src/types";

/**
 * Phase 2.7 (#35) route-level guard: /api/entries?q=... must reject any q
 * value longer than 200 characters with a 400. The frontend's
 * `<input maxLength={200}>` keeps the operator UI honest; this test pins the
 * defense-in-depth cap that catches direct URL manipulation.
 *
 * Mirrors the in-process API harness from tests/guardrails-create-api.test.ts.
 */

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    timestamp: new Date().toISOString(),
    toolName: "exec",
    params: { command: "echo hi" },
    decision: "allow",
    agentId: "alpha",
    toolCallId: "tc_route_q",
    sessionKey: "sess_route_q",
    riskScore: 10,
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

function makeReq(url: string): IncomingMessage {
  const handlers: Record<string, Array<(chunk?: Buffer | string) => void>> = {};
  const req = {
    url,
    method: "GET",
    headers: { host: "localhost:18789" },
    on: (event: string, handler: (chunk?: Buffer | string) => void) => {
      let list = handlers[event];
      if (!list) {
        list = [];
        handlers[event] = list;
      }
      list.push(handler);
      if (event === "end") queueMicrotask(handler);
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

describe("/api/entries — q param", () => {
  it("rejects q longer than 200 chars with 400", async () => {
    const { api, handler } = makeApi();
    registerDashboardRoutes(api, { auditLogger: buildLogger([entry()]) });

    const tooLong = "a".repeat(201);
    const { res, out } = makeRes();
    await handler()(makeReq(`/plugins/clawlens/api/entries?q=${encodeURIComponent(tooLong)}`), res);
    expect(out.status).toBe(400);
    const body = JSON.parse(out.body);
    expect(body.error).toMatch(/200/);
  });

  it("accepts q at exactly 200 chars", async () => {
    const { api, handler } = makeApi();
    registerDashboardRoutes(api, { auditLogger: buildLogger([entry()]) });

    const exact = "a".repeat(200);
    const { res, out } = makeRes();
    await handler()(makeReq(`/plugins/clawlens/api/entries?q=${encodeURIComponent(exact)}`), res);
    expect(out.status).toBe(200);
    // Empty result is fine — none of the audit fixtures contain "aaaa…".
    const body = JSON.parse(out.body);
    expect(Array.isArray(body)).toBe(true);
  });

  it("forwards q to getRecentEntries when within the cap", async () => {
    const { api, handler } = makeApi();
    const entries: AuditEntry[] = [
      entry({ toolCallId: "tc_match", params: { command: "ssh prod" } }),
      entry({
        toolCallId: "tc_skip",
        toolName: "fetch",
        params: { url: "https://example.com" },
      }),
    ];
    registerDashboardRoutes(api, { auditLogger: buildLogger(entries) });

    const { res, out } = makeRes();
    await handler()(makeReq("/plugins/clawlens/api/entries?q=ssh"), res);
    expect(out.status).toBe(200);
    const body = JSON.parse(out.body);
    expect(body.map((e: { toolCallId: string }) => e.toolCallId)).toEqual(["tc_match"]);
  });

  it("ignores empty q (returns full result)", async () => {
    const { api, handler } = makeApi();
    const entries: AuditEntry[] = [
      entry({ toolCallId: "tc_a" }),
      entry({ toolCallId: "tc_b", toolName: "read" }),
    ];
    registerDashboardRoutes(api, { auditLogger: buildLogger(entries) });

    const { res, out } = makeRes();
    await handler()(makeReq("/plugins/clawlens/api/entries?q="), res);
    expect(out.status).toBe(200);
    const body = JSON.parse(out.body);
    expect(body).toHaveLength(2);
  });
});
