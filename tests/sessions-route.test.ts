import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditEntry, AuditLogger } from "../src/audit/logger";
import { registerDashboardRoutes } from "../src/dashboard/routes";
import type { HttpRouteHandler, HttpRouteParams, OpenClawPluginApi } from "../src/types";

/**
 * Tests for §4.3 — /api/sessions query param parsing for risk / duration /
 * since, default page size 25, and silent drop of unknown values.
 *
 * Mirrors the harness from tests/dashboard-entries-route.test.ts.
 */

const NOW = new Date("2026-04-26T18:00:00.000Z");

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    timestamp: new Date().toISOString(),
    toolName: "exec",
    params: { command: "echo hi" },
    decision: "allow",
    agentId: "alpha",
    sessionKey: "sess",
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

describe("/api/sessions — query params", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("filters by risk tier", async () => {
    const start = new Date(NOW.getTime() - 60 * 60_000).toISOString();
    const end = new Date(NOW.getTime() - 50 * 60_000).toISOString();
    const entries: AuditEntry[] = [
      entry({ sessionKey: "low", agentId: "alpha", timestamp: start, riskScore: 10 }),
      entry({ sessionKey: "low", agentId: "alpha", timestamp: end, riskScore: 10 }),
      entry({ sessionKey: "high", agentId: "beta", timestamp: start, riskScore: 70 }),
      entry({ sessionKey: "high", agentId: "beta", timestamp: end, riskScore: 70 }),
    ];
    const { api, handler } = makeApi();
    registerDashboardRoutes(api, { auditLogger: buildLogger(entries) });

    const { res, out } = makeRes();
    await handler()(makeReq("/plugins/clawlens/api/sessions?risk=high"), res);
    expect(out.status).toBe(200);
    const body = JSON.parse(out.body) as { sessions: { sessionKey: string }[]; total: number };
    expect(body.total).toBe(1);
    expect(body.sessions[0].sessionKey).toBe("high");
  });

  it("filters by duration bucket", async () => {
    const startA = new Date(NOW.getTime() - 60 * 60_000).toISOString();
    const endShort = new Date(NOW.getTime() - 60 * 60_000 + 30_000).toISOString(); // 30s
    const startB = new Date(NOW.getTime() - 50 * 60_000).toISOString();
    const endLong = new Date(NOW.getTime() - 30 * 60_000).toISOString(); // 20min
    const entries: AuditEntry[] = [
      entry({ sessionKey: "short", timestamp: startA }),
      entry({ sessionKey: "short", timestamp: endShort }),
      entry({ sessionKey: "long", timestamp: startB }),
      entry({ sessionKey: "long", timestamp: endLong }),
    ];
    const { api, handler } = makeApi();
    registerDashboardRoutes(api, { auditLogger: buildLogger(entries) });

    const { res, out } = makeRes();
    await handler()(makeReq("/plugins/clawlens/api/sessions?duration=lt1m"), res);
    expect(out.status).toBe(200);
    const body = JSON.parse(out.body) as { sessions: { sessionKey: string }[]; total: number };
    expect(body.total).toBe(1);
    expect(body.sessions[0].sessionKey).toBe("short");
  });

  it("filters by since window", async () => {
    const oldStart = new Date(NOW.getTime() - 25 * 3600_000).toISOString();
    const oldEnd = new Date(NOW.getTime() - 24.5 * 3600_000).toISOString();
    const recentStart = new Date(NOW.getTime() - 30 * 60_000).toISOString();
    const recentEnd = new Date(NOW.getTime() - 25 * 60_000).toISOString();
    const entries: AuditEntry[] = [
      entry({ sessionKey: "old", timestamp: oldStart }),
      entry({ sessionKey: "old", timestamp: oldEnd }),
      entry({ sessionKey: "fresh", timestamp: recentStart }),
      entry({ sessionKey: "fresh", timestamp: recentEnd }),
    ];
    const { api, handler } = makeApi();
    registerDashboardRoutes(api, { auditLogger: buildLogger(entries) });

    const { res, out } = makeRes();
    await handler()(makeReq("/plugins/clawlens/api/sessions?since=24h"), res);
    expect(out.status).toBe(200);
    const body = JSON.parse(out.body) as { sessions: { sessionKey: string }[]; total: number };
    expect(body.total).toBe(1);
    expect(body.sessions[0].sessionKey).toBe("fresh");
  });

  it("silently drops unknown filter values (no 400)", async () => {
    const start = new Date(NOW.getTime() - 30 * 60_000).toISOString();
    const end = new Date(NOW.getTime() - 25 * 60_000).toISOString();
    const entries: AuditEntry[] = [
      entry({ sessionKey: "s1", timestamp: start }),
      entry({ sessionKey: "s1", timestamp: end }),
    ];
    const { api, handler } = makeApi();
    registerDashboardRoutes(api, { auditLogger: buildLogger(entries) });

    const { res, out } = makeRes();
    await handler()(
      makeReq("/plugins/clawlens/api/sessions?risk=banana&duration=xyz&since=neverland"),
      res,
    );
    expect(out.status).toBe(200);
    const body = JSON.parse(out.body) as { sessions: unknown[]; total: number };
    expect(body.total).toBe(1);
  });

  it("default limit clamps to 25 (page size bumped from 10)", async () => {
    // Build 30 closed sessions across distinct session keys.
    const entries: AuditEntry[] = [];
    for (let i = 0; i < 30; i++) {
      const startOffset = (i + 1) * 60 * 60_000; // 1h, 2h, ...
      const start = new Date(NOW.getTime() - startOffset).toISOString();
      const end = new Date(NOW.getTime() - startOffset + 30_000).toISOString();
      entries.push(entry({ sessionKey: `s${i}`, timestamp: start }));
      entries.push(entry({ sessionKey: `s${i}`, timestamp: end }));
    }
    const { api, handler } = makeApi();
    registerDashboardRoutes(api, { auditLogger: buildLogger(entries) });

    const { res, out } = makeRes();
    await handler()(makeReq("/plugins/clawlens/api/sessions"), res);
    expect(out.status).toBe(200);
    const body = JSON.parse(out.body) as { sessions: unknown[]; total: number };
    expect(body.total).toBe(30);
    expect(body.sessions).toHaveLength(25);
  });
});
