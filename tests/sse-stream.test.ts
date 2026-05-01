import * as fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditEntry, AuditLogger } from "../src/audit/logger";
import { registerDashboardRoutes } from "../src/dashboard/routes";
import { extractIdentityKey } from "../src/guardrails/identity";
import { GuardrailStore } from "../src/guardrails/store";
import type { Guardrail } from "../src/guardrails/types";
import type { HttpRouteHandler, HttpRouteParams, OpenClawPluginApi } from "../src/types";

/** Minimal AuditEntry factory — mirrors dashboard-v2-api.test.ts. */
function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    timestamp: "2026-04-18T12:00:00.000Z",
    toolName: "exec",
    params: {},
    prevHash: "0",
    hash: "abc",
    ...overrides,
  };
}

/**
 * Capture the listener that the SSE handler registers via auditLogger.on.
 * Tests fire entries through this directly to inspect the SSE payload without
 * booting an HTTP server or EventSource.
 */
function buildLogger(seedEntries: AuditEntry[]): {
  logger: AuditLogger;
  fireEntry: (e: AuditEntry) => void;
} {
  let captured: ((e: AuditEntry) => void) | null = null;
  const logger = {
    readEntries: () => seedEntries,
    readEntriesRaw: () => seedEntries,
    on: vi.fn((evt: string, fn: (e: AuditEntry) => void) => {
      if (evt === "entry") captured = fn;
    }),
    off: vi.fn(),
    // biome-ignore lint/suspicious/noExplicitAny: minimal AuditLogger shape
  } as any as AuditLogger;
  return {
    logger,
    fireEntry: (e: AuditEntry) => {
      if (!captured) throw new Error("SSE listener was never registered");
      captured(e);
    },
  };
}

function makeApi(): {
  api: OpenClawPluginApi;
  getHandler: () => HttpRouteHandler;
} {
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
    getHandler: () => {
      if (!captured) throw new Error("route handler was never registered");
      return captured;
    },
  };
}

function makeReq(url: string): IncomingMessage {
  const handlers: Record<string, Array<(...a: unknown[]) => void>> = {};
  return {
    url,
    method: "GET",
    headers: { host: "localhost:18789" },
    on: (evt: string, fn: (...a: unknown[]) => void) => {
      let list = handlers[evt];
      if (!list) {
        list = [];
        handlers[evt] = list;
      }
      list.push(fn);
    },
    // biome-ignore lint/suspicious/noExplicitAny: minimal IncomingMessage shape
  } as any as IncomingMessage;
}

interface CapturedResponse {
  status: number;
  headers: Record<string, string | number>;
  body: string;
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
  } as any as ServerResponse;
  return { res, out };
}

function tmpGuardrailStore(): { store: GuardrailStore; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawlens-sse-"));
  const file = path.join(dir, "guardrails.json");
  const store = new GuardrailStore(file);
  return { store, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/** Parse the first SSE `data:` line from a captured body. */
function parseSSEData(body: string): Record<string, unknown> {
  const m = body.match(/data: (.+?)\n\n/);
  if (!m) throw new Error(`no SSE data frame found in body: ${JSON.stringify(body)}`);
  return JSON.parse(m[1]) as Record<string, unknown>;
}

describe("SSE /api/stream — payload contract", () => {
  let cleanups: Array<() => void> = [];
  beforeEach(() => {
    cleanups = [];
  });
  afterEach(() => {
    for (const c of cleanups) c();
  });

  it("includes effectiveDecision and category", async () => {
    const { logger, fireEntry } = buildLogger([]);
    const { api, getHandler } = makeApi();
    registerDashboardRoutes(api, { auditLogger: logger });
    const { res, out } = makeRes();
    await getHandler()(makeReq("/plugins/clawlens/api/stream"), res);

    fireEntry(
      entry({
        toolName: "exec",
        decision: "allow",
        params: { command: "ls -la" },
      }),
    );

    const payload = parseSSEData(out.body);
    expect(payload.effectiveDecision).toBe("allow");
    // `ls` is read-only exec → `exploring` bucket, not the old generic
    // `commands` bucket. Proves SSE honors exec sub-category routing.
    expect(payload.category).toBe("exploring");
  });

  it("populates execCategory for exec tool calls", async () => {
    const { logger, fireEntry } = buildLogger([]);
    const { api, getHandler } = makeApi();
    registerDashboardRoutes(api, { auditLogger: logger });
    const { res, out } = makeRes();
    await getHandler()(makeReq("/plugins/clawlens/api/stream"), res);

    fireEntry(
      entry({
        toolName: "exec",
        decision: "allow",
        params: { command: "git status" },
      }),
    );

    const payload = parseSSEData(out.body);
    expect(payload.execCategory).toBeDefined();
    expect(typeof payload.execCategory).toBe("string");
  });

  it("omits execCategory for non-exec tools", async () => {
    const { logger, fireEntry } = buildLogger([]);
    const { api, getHandler } = makeApi();
    registerDashboardRoutes(api, { auditLogger: logger });
    const { res, out } = makeRes();
    await getHandler()(makeReq("/plugins/clawlens/api/stream"), res);

    fireEntry(
      entry({
        toolName: "read",
        decision: "allow",
        params: { path: "/etc/hosts" },
      }),
    );

    const payload = parseSSEData(out.body);
    expect(payload.execCategory).toBeUndefined();
  });

  it("uses LLM-adjusted score when an eval entry refers to the tool call", async () => {
    const evalEntry: AuditEntry = entry({
      timestamp: "2026-04-18T12:00:01.000Z",
      toolName: "llm_evaluation",
      // biome-ignore lint/suspicious/noExplicitAny: refToolCallId is a known optional AuditEntry field
      ...({ refToolCallId: "tc-1" } as any),
      llmEvaluation: {
        adjustedScore: 88,
        reasoning: "scope creep on production data",
        tags: ["scope-creep"],
        confidence: "high",
        patterns: [],
      },
      riskTier: "critical",
      riskTags: ["llm:scope-creep"],
    });
    const { logger, fireEntry } = buildLogger([evalEntry]);
    const { api, getHandler } = makeApi();
    registerDashboardRoutes(api, { auditLogger: logger });
    const { res, out } = makeRes();
    await getHandler()(makeReq("/plugins/clawlens/api/stream"), res);

    fireEntry(
      entry({
        toolName: "exec",
        decision: "allow",
        toolCallId: "tc-1",
        riskScore: 30,
        riskTier: "low",
        params: { command: "rm -rf /" },
      }),
    );

    const payload = parseSSEData(out.body);
    expect(payload.riskScore).toBe(88);
    expect(payload.originalRiskScore).toBe(30);
    expect(payload.riskTier).toBe("critical");
    expect(payload.llmEvaluation).toMatchObject({ adjustedScore: 88 });
  });

  it("falls back to entry.riskScore and leaves originalRiskScore unset when no LLM eval", async () => {
    const { logger, fireEntry } = buildLogger([]);
    const { api, getHandler } = makeApi();
    registerDashboardRoutes(api, { auditLogger: logger });
    const { res, out } = makeRes();
    await getHandler()(makeReq("/plugins/clawlens/api/stream"), res);

    fireEntry(
      entry({
        toolName: "exec",
        decision: "allow",
        toolCallId: "tc-no-eval",
        riskScore: 42,
        riskTier: "medium",
        params: { command: "ls" },
      }),
    );

    const payload = parseSSEData(out.body);
    expect(payload.riskScore).toBe(42);
    expect(payload.originalRiskScore).toBeUndefined();
    expect(payload.riskTier).toBe("medium");
  });

  it("includes guardrailMatch when an active guardrail matches the entry", async () => {
    const { store, cleanup } = tmpGuardrailStore();
    cleanups.push(cleanup);
    const params = { command: "rm -rf /" };
    const guardrail: Guardrail = {
      id: "g-block-rm",
      selector: { agent: null, tools: { mode: "names", values: ["exec"] } },
      target: { kind: "identity-glob", pattern: extractIdentityKey("exec", params) },
      action: "block",
      createdAt: "2026-04-18T11:00:00.000Z",
      source: { toolCallId: "tc-x", sessionKey: "s", agentId: "agent-a" },
      description: "exec — rm -rf /",
      riskScore: 95,
    };
    store.add(guardrail);

    const { logger, fireEntry } = buildLogger([]);
    const { api, getHandler } = makeApi();
    registerDashboardRoutes(api, {
      auditLogger: logger,
      guardrailStore: store,
    });
    const { res, out } = makeRes();
    await getHandler()(makeReq("/plugins/clawlens/api/stream"), res);

    fireEntry(
      entry({
        toolName: "exec",
        decision: "allow",
        agentId: "agent-a",
        params,
      }),
    );

    const payload = parseSSEData(out.body);
    expect(payload.guardrailMatch).toEqual({
      id: "g-block-rm",
      action: "block",
    });
  });

  it("omits guardrailMatch when no guardrail matches", async () => {
    const { store, cleanup } = tmpGuardrailStore();
    cleanups.push(cleanup);

    const { logger, fireEntry } = buildLogger([]);
    const { api, getHandler } = makeApi();
    registerDashboardRoutes(api, {
      auditLogger: logger,
      guardrailStore: store,
    });
    const { res, out } = makeRes();
    await getHandler()(makeReq("/plugins/clawlens/api/stream"), res);

    fireEntry(
      entry({
        toolName: "exec",
        decision: "allow",
        agentId: "agent-a",
        params: { command: "ls" },
      }),
    );

    const payload = parseSSEData(out.body);
    expect(payload.guardrailMatch).toBeUndefined();
  });

  it("preserves split-session-key resolution when the session was split by a > 30 min gap", async () => {
    // Session key "s1" reused after a 31-minute gap → splitter assigns "#2"
    // to the recent run.
    const oldStart = "2026-04-18T10:00:00.000Z";
    const oldEnd = "2026-04-18T10:05:00.000Z";
    const newStart = "2026-04-18T11:00:00.000Z"; // 55 min gap
    const seeded: AuditEntry[] = [
      entry({ timestamp: oldStart, sessionKey: "s1", agentId: "agent-a" }),
      entry({ timestamp: oldEnd, sessionKey: "s1", agentId: "agent-a" }),
      entry({ timestamp: newStart, sessionKey: "s1", agentId: "agent-a" }),
    ];
    const { logger, fireEntry } = buildLogger(seeded);
    const { api, getHandler } = makeApi();
    registerDashboardRoutes(api, { auditLogger: logger });
    const { res, out } = makeRes();
    await getHandler()(makeReq("/plugins/clawlens/api/stream"), res);

    fireEntry(
      entry({
        timestamp: newStart,
        sessionKey: "s1",
        agentId: "agent-a",
        decision: "allow",
        params: { command: "ls" },
      }),
    );

    const payload = parseSSEData(out.body);
    // Recent run gets the suffix; old run keeps "s1".
    expect(payload.sessionKey).toBe("s1#2");
  });
});
