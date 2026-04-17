import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditEntry, AuditLogger } from "../src/audit/logger";
import { registerDashboardRoutes } from "../src/dashboard/routes";
import type { HttpRouteHandler, HttpRouteParams, OpenClawPluginApi } from "../src/types";

/** Build a minimal AuditEntry with overrides. */
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

/**
 * Build a minimal OpenClawPluginApi double that captures the route handler so
 * tests can invoke it directly without binding to a TCP port.
 */
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
  return {
    url,
    method: "GET",
    headers: { host: "localhost:18789" },
    on: vi.fn(),
    // biome-ignore lint/suspicious/noExplicitAny: minimal IncomingMessage shape for the handler
  } as any;
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
    // biome-ignore lint/suspicious/noExplicitAny: minimal ServerResponse shape for the handler
  } as any;
  return { res, out };
}

/**
 * Wire a fake AuditLogger that returns the supplied entries from
 * readEntries() / readEntriesRaw(). The export route only calls readEntries,
 * but readEntriesRaw is included so other routes don't crash if invoked.
 */
function buildLogger(entries: AuditEntry[]): AuditLogger {
  return {
    readEntries: () => entries,
    readEntriesRaw: () => entries,
    on: vi.fn(),
    off: vi.fn(),
    // biome-ignore lint/suspicious/noExplicitAny: only the read methods are exercised
  } as any;
}

describe("/api/audit/export", () => {
  let api: OpenClawPluginApi;
  let getHandler: () => HttpRouteHandler;
  let logger: AuditLogger;

  beforeEach(() => {
    const made = makeApi();
    api = made.api;
    getHandler = made.handler;
    logger = buildLogger([
      entry({ timestamp: "2026-04-17T10:00:00Z", decision: "allow", agentId: "alpha" }),
      entry({ timestamp: "2026-04-17T11:00:00Z", decision: "block", agentId: "beta" }),
      entry({ timestamp: "2026-04-16T10:00:00Z", decision: "allow", agentId: "gamma" }),
      entry({ timestamp: "2026-04-15T10:00:00Z", decision: "allow", agentId: "delta" }),
    ]);
    registerDashboardRoutes(api, { auditLogger: logger });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns 200 with the correct headers for a valid date", async () => {
    const { res, out } = makeRes();
    await getHandler()(makeReq("/plugins/clawlens/api/audit/export?date=2026-04-17"), res);

    expect(out.status).toBe(200);
    expect(out.headers["Content-Type"]).toBe("application/x-ndjson; charset=utf-8");
    expect(out.headers["Content-Disposition"]).toBe(
      'attachment; filename="clawlens-audit-2026-04-17.jsonl"',
    );
    expect(out.headers["Cache-Control"]).toBe("no-cache");
  });

  it("body is newline-separated JSON; every entry is on the requested date", async () => {
    const { res, out } = makeRes();
    await getHandler()(makeReq("/plugins/clawlens/api/audit/export?date=2026-04-17"), res);

    const lines = out.body.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(2); // both 2026-04-17 entries
    for (const line of lines) {
      const parsed = JSON.parse(line) as AuditEntry;
      expect(parsed.timestamp.startsWith("2026-04-17")).toBe(true);
    }
  });

  it("excludes entries from other dates", async () => {
    const { res, out } = makeRes();
    await getHandler()(makeReq("/plugins/clawlens/api/audit/export?date=2026-04-15"), res);

    const lines = out.body.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]) as AuditEntry;
    expect(parsed.agentId).toBe("delta");
  });

  it("returns 400 with a JSON error body when the date is malformed", async () => {
    const { res, out } = makeRes();
    await getHandler()(makeReq("/plugins/clawlens/api/audit/export?date=nope"), res);

    expect(out.status).toBe(400);
    expect(out.headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(out.body) as { error: string };
    expect(body.error).toContain("Invalid date format");
  });

  it("rejects gibberish like '../../../etc/passwd'", async () => {
    const { res, out } = makeRes();
    await getHandler()(
      makeReq("/plugins/clawlens/api/audit/export?date=..%2F..%2Fetc%2Fpasswd"),
      res,
    );
    expect(out.status).toBe(400);
  });

  it("falls back to today (200) when ?date is omitted", async () => {
    const { res, out } = makeRes();
    await getHandler()(makeReq("/plugins/clawlens/api/audit/export"), res);

    expect(out.status).toBe(200);
    // Filename should use *today's* local date, not be empty.
    const cd = String(out.headers["Content-Disposition"]);
    expect(cd).toMatch(/filename="clawlens-audit-\d{4}-\d{2}-\d{2}\.jsonl"/);
  });

  it("returns 200 with an empty body when no entries match", async () => {
    const { res, out } = makeRes();
    await getHandler()(makeReq("/plugins/clawlens/api/audit/export?date=2025-01-01"), res);

    expect(out.status).toBe(200);
    expect(out.body).toBe("");
  });

  it("returns 200 with empty body when the audit log is empty", async () => {
    // Re-register with an empty logger so the captured handler reads from it.
    const empty = buildLogger([]);
    const made = makeApi();
    registerDashboardRoutes(made.api, { auditLogger: empty });

    const { res, out } = makeRes();
    await made.handler()(makeReq("/plugins/clawlens/api/audit/export?date=2026-04-17"), res);
    expect(out.status).toBe(200);
    expect(out.body).toBe("");
  });

  it("emits well-formed NDJSON: each line is a complete JSON object terminated by \\n", async () => {
    const { res, out } = makeRes();
    await getHandler()(makeReq("/plugins/clawlens/api/audit/export?date=2026-04-17"), res);

    // Body should end with \n after every record (no trailing partial line).
    const trailing = out.body.slice(-1);
    expect(trailing).toBe("\n");
    // No empty lines in the middle either.
    const segments = out.body.split("\n");
    // Last element after final \n is "".
    expect(segments[segments.length - 1]).toBe("");
    for (const s of segments.slice(0, -1)) {
      expect(s.length).toBeGreaterThan(0);
      expect(() => JSON.parse(s)).not.toThrow();
    }
  });
});
