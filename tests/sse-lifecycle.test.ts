import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuditLogger } from "../src/audit/logger";
import { registerDashboardRoutes, tearDownSseConnections } from "../src/dashboard/routes";

// Fake req: minimal EventEmitter that mirrors the http.IncomingMessage surface
// the SSE handler touches (req.url, req.method, req.headers, req.once).
// Real http requests are EventEmitters — using one keeps cleanup wiring honest
// (req.once("close", cleanup) etc. fire exactly the way they would in prod).
function fakeReq(url = "/plugins/clawlens/api/stream") {
  const req = new EventEmitter() as EventEmitter & {
    url: string;
    method: string;
    headers: Record<string, string>;
  };
  req.url = url;
  req.method = "GET";
  req.headers = { host: "localhost:18789" };
  return req;
}

// Fake res: EventEmitter that captures writeHead/write/end calls without
// touching the network. writableEnded flips on end() so the cleanup path
// matches what http.ServerResponse exposes.
function fakeRes() {
  const res = new EventEmitter() as EventEmitter & {
    writeHead: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
    writableEnded: boolean;
  };
  res.writeHead = vi.fn();
  res.write = vi.fn();
  res.end = vi.fn(() => {
    res.writableEnded = true;
  });
  res.writableEnded = false;
  return res;
}

interface CapturedHandler {
  handler: (
    req: ReturnType<typeof fakeReq>,
    res: ReturnType<typeof fakeRes>,
  ) => Promise<boolean | undefined>;
}

function captureRouteHandler(auditLogger: AuditLogger): CapturedHandler {
  // Minimal api shim. registerDashboardRoutes only touches registerHttpRoute
  // and logger in the SSE-relevant path.
  const captured: Partial<CapturedHandler> = {};
  const api = {
    registerHttpRoute: vi.fn((opts: { handler: CapturedHandler["handler"] }) => {
      captured.handler = opts.handler;
    }),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    // biome-ignore lint/suspicious/noExplicitAny: test shim
  } as any;
  registerDashboardRoutes(api, { auditLogger });
  if (!captured.handler) {
    throw new Error("registerDashboardRoutes did not invoke registerHttpRoute");
  }
  return captured as CapturedHandler;
}

// Each test gets a fresh AuditLogger instance whose listener counts start at 0
// so the assertions are absolute (not "delta from baseline"). We never call
// .init() or emit "entry", so no filesystem side effects.
let auditLogger: AuditLogger;

beforeEach(() => {
  auditLogger = new AuditLogger("/tmp/sse-lifecycle-test-never-written.jsonl");
  // Clear any residual connections from prior tests sharing the globalThis
  // registry. tearDownSseConnections is idempotent by contract.
  tearDownSseConnections();
});

afterEach(() => {
  // Defensive: paranoid-clean even if a test threw.
  tearDownSseConnections();
  auditLogger.removeAllListeners();
  vi.clearAllMocks();
});

describe("SSE teardown under listener pressure (issue #77, contract 1)", () => {
  // The bug: each hot reload leaks per-connection 'entry' listeners on the
  // process-singleton AuditLogger. Node logs MaxListenersExceededWarning at
  // 11 listeners. tearDownSseConnections() must drain every active stream so
  // the next register() starts clean and the warning never fires.
  it("removes every 'entry' listener and ends every response when tearDownSseConnections() runs", async () => {
    const { handler } = captureRouteHandler(auditLogger);
    expect(auditLogger.listenerCount("entry")).toBe(0);

    // Open 11 SSE connections — one past Node's default MaxListeners=10 so a
    // pre-fix run would have already tripped the warning.
    const responses: Array<ReturnType<typeof fakeRes>> = [];
    for (let i = 0; i < 11; i++) {
      const req = fakeReq();
      const res = fakeRes();
      responses.push(res);
      await handler(req, res);
    }
    expect(auditLogger.listenerCount("entry")).toBe(11);
    for (const res of responses) {
      expect(res.writableEnded).toBe(false);
    }

    const drained = tearDownSseConnections();

    expect(drained).toBe(11);
    expect(auditLogger.listenerCount("entry")).toBe(0);
    for (const res of responses) {
      expect(res.end).toHaveBeenCalled();
      expect(res.writableEnded).toBe(true);
    }
  });

  it("is idempotent — calling tearDownSseConnections() twice does not throw or double-remove", async () => {
    const { handler } = captureRouteHandler(auditLogger);
    for (let i = 0; i < 3; i++) await handler(fakeReq(), fakeRes());
    expect(auditLogger.listenerCount("entry")).toBe(3);

    expect(tearDownSseConnections()).toBe(3);
    expect(auditLogger.listenerCount("entry")).toBe(0);

    // Second call sees an empty registry and returns 0 without crashing.
    expect(tearDownSseConnections()).toBe(0);
    expect(auditLogger.listenerCount("entry")).toBe(0);
  });
});

describe("Idempotent per-stream cleanup (issue #77, contract 4 — three cleanup paths)", () => {
  // Real connections can be torn down through req.close (most common),
  // res.close (server-initiated end), or req.error (aborted/HTTP-2/proxy
  // half-close). Each path must run cleanup exactly once. The first event to
  // fire wins; later events on the same connection must be no-ops.

  it("cleans up exactly once via req.once('close')", async () => {
    const { handler } = captureRouteHandler(auditLogger);
    const offSpy = vi.spyOn(auditLogger, "off");
    const req = fakeReq();
    const res = fakeRes();
    await handler(req, res);
    expect(auditLogger.listenerCount("entry")).toBe(1);

    req.emit("close");

    expect(auditLogger.listenerCount("entry")).toBe(0);
    expect(offSpy).toHaveBeenCalledTimes(1);
    expect(res.end).toHaveBeenCalledTimes(1);
  });

  it("cleans up exactly once via res.once('close')", async () => {
    const { handler } = captureRouteHandler(auditLogger);
    const offSpy = vi.spyOn(auditLogger, "off");
    const req = fakeReq();
    const res = fakeRes();
    await handler(req, res);
    expect(auditLogger.listenerCount("entry")).toBe(1);

    res.emit("close");

    expect(auditLogger.listenerCount("entry")).toBe(0);
    expect(offSpy).toHaveBeenCalledTimes(1);
  });

  it("cleans up exactly once via req.once('error')", async () => {
    const { handler } = captureRouteHandler(auditLogger);
    const offSpy = vi.spyOn(auditLogger, "off");
    const req = fakeReq();
    const res = fakeRes();
    await handler(req, res);
    expect(auditLogger.listenerCount("entry")).toBe(1);

    // EventEmitter throws on emit("error") unless there's a listener; the
    // cleanup binding itself counts. Wrap defensively just in case.
    try {
      req.emit("error", new Error("simulated socket abort"));
    } catch {
      // shouldn't throw — we registered req.once("error", cleanup)
    }

    expect(auditLogger.listenerCount("entry")).toBe(0);
    expect(offSpy).toHaveBeenCalledTimes(1);
  });

  it("does NOT double-invoke cleanup when multiple teardown signals fire on one connection", async () => {
    // Common in practice: req.close fires, the cleanup ends the response,
    // res then emits 'close' as a consequence of res.end(). The second
    // event must be a no-op — the listener is already off, the response is
    // already ended, the registry entry is already gone.
    const { handler } = captureRouteHandler(auditLogger);
    const offSpy = vi.spyOn(auditLogger, "off");
    const req = fakeReq();
    const res = fakeRes();
    await handler(req, res);

    req.emit("close");
    res.emit("close");
    try {
      req.emit("error", new Error("after-close error"));
    } catch {
      // ignore
    }

    expect(auditLogger.listenerCount("entry")).toBe(0);
    expect(offSpy).toHaveBeenCalledTimes(1);
    expect(res.end).toHaveBeenCalledTimes(1);
  });
});

describe("SSE registry survives plugin module identity (globalThis-scoped)", () => {
  // The AuditLogger is globalThis-keyed (Symbol.for("clawlens.AuditLogger.instances"))
  // so an embedded-agent re-import of the plugin module still sees the same
  // logger. The SSE registry must use the same scope or tearDown across a
  // reload would miss listeners from the prior module instance.
  it("uses a globalThis Symbol.for slot, not a module-scoped variable", () => {
    const slot = Object.getOwnPropertySymbols(globalThis).find(
      (s) => s.toString() === "Symbol(clawlens.sse.activeConnections)",
    );
    expect(
      slot,
      "expected globalThis to expose clawlens.sse.activeConnections after import",
    ).toBeDefined();
  });
});
