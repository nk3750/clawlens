import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock all heavy dependencies so we can test registration logic in isolation
vi.mock("../src/audit/logger", () => {
  const buildMockLogger = () => ({
    init: vi.fn(),
    readEntries: vi.fn().mockReturnValue([]),
    flush: vi.fn(),
    logDecision: vi.fn(),
    appendEvaluation: vi.fn(),
  });
  return {
    AuditLogger: vi.fn().mockImplementation(buildMockLogger),
    getAuditLogger: vi.fn().mockImplementation(buildMockLogger),
  };
});

// SSE teardown is invoked from register() at the top of each call to drop
// listeners from prior plugin registries. Spy on it so the lifecycle tests
// can assert ordering.
const tearDownSseConnectionsSpy = vi.hoisted(() => vi.fn());
vi.mock("../src/dashboard/routes", () => ({
  registerDashboardRoutes: vi.fn(),
  tearDownSseConnections: tearDownSseConnectionsSpy,
}));

vi.mock("../src/risk/eval-cache", () => ({
  EvalCache: vi.fn().mockImplementation(() => ({
    get: vi.fn(),
    maybeCache: vi.fn(),
    warmFromAuditLog: vi.fn().mockReturnValue(0),
    clear: vi.fn(),
  })),
}));

vi.mock("../src/risk/session-context", () => ({
  SessionContext: vi.fn().mockImplementation(() => ({
    record: vi.fn(),
    getRecent: vi.fn().mockReturnValue([]),
    cleanup: vi.fn(),
  })),
}));

vi.mock("../src/hooks/before-tool-call", () => {
  const handler = vi.fn();
  return {
    createBeforeToolCallHandler: vi.fn().mockReturnValue(handler),
    __mockHandler: handler,
  };
});

vi.mock("../src/hooks/after-tool-call", () => ({
  createAfterToolCallHandler: vi.fn().mockReturnValue(vi.fn()),
}));

vi.mock("../src/hooks/session-start", () => ({
  createSessionStartHandler: vi.fn().mockReturnValue(vi.fn()),
}));

vi.mock("../src/hooks/session-end", () => ({
  createSessionEndHandler: vi.fn().mockReturnValue(vi.fn()),
}));

vi.mock("../src/config", () => ({
  resolveConfig: vi.fn().mockReturnValue({
    auditLogPath: "/tmp/test-audit.jsonl",
    retention: "30d",
    digest: { schedule: "daily" },
    risk: {
      llmEvalThreshold: 50,
      llmEnabled: true,
      llmModel: "",
      llmApiKeyEnv: "ANTHROPIC_API_KEY",
      llmProvider: "anthropic",
    },
    alerts: { enabled: false, threshold: 80 },
  }),
}));

vi.mock("../src/audit/exporter", () => ({
  exportToCSV: vi.fn(),
  exportToJSON: vi.fn(),
}));

function mockApi(id = "api-1") {
  const hooks: Record<string, Array<(...args: unknown[]) => unknown>> = {};
  return {
    _id: id,
    id: "clawlens",
    name: "ClawLens",
    config: {},
    pluginConfig: {},
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    on: vi.fn((hookName: string, handler: (...args: unknown[]) => unknown) => {
      if (!hooks[hookName]) hooks[hookName] = [];
      hooks[hookName].push(handler);
    }),
    registerGatewayMethod: vi.fn(),
    registerService: vi.fn(),
    registerCli: vi.fn(),
    registerHttpRoute: vi.fn(),
    resolvePath: vi.fn((p: string) => p),
    _hooks: hooks,
  };
}

describe("index.ts register()", () => {
  beforeEach(async () => {
    // Reset module-level state between tests by re-importing
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("registers hooks on both api objects when called with two different apis", async () => {
    const plugin = (await import("../index")).default;
    const api1 = mockApi("gateway");
    const api2 = mockApi("plugins");

    plugin.register!(api1 as never);
    plugin.register!(api2 as never);

    // Both apis should have before_tool_call registered
    const api1Hooks = api1.on.mock.calls.filter((c: unknown[]) => c[0] === "before_tool_call");
    const api2Hooks = api2.on.mock.calls.filter((c: unknown[]) => c[0] === "before_tool_call");

    expect(api1Hooks).toHaveLength(1);
    expect(api2Hooks).toHaveLength(1);

    // Both should use the same handler instance (not duplicated)
    expect(api1Hooks[0][1]).toBe(api2Hooks[0][1]);
  });

  it("does not double-register hooks on the same api object", async () => {
    const plugin = (await import("../index")).default;
    const api = mockApi("same");

    plugin.register!(api as never);
    plugin.register!(api as never);

    const hookCalls = api.on.mock.calls.filter((c: unknown[]) => c[0] === "before_tool_call");

    // Only one registration on the same api
    expect(hookCalls).toHaveLength(1);
  });

  it("does not double-register service/CLI/dashboard on the same api object", async () => {
    // Within one registry, idempotency holds: register(api) twice still
    // results in one service registration, one CLI registration, and one
    // dashboard route binding. This is the inner-loop contract — separate
    // from the per-registry hot-reload contract below.
    const plugin = (await import("../index")).default;
    const { registerDashboardRoutes } = await import("../src/dashboard/routes");
    const api = mockApi("same-registry");

    plugin.register!(api as never);
    plugin.register!(api as never);

    expect(api.registerService).toHaveBeenCalledOnce();
    expect(api.registerCli).toHaveBeenCalledOnce();
    expect(registerDashboardRoutes).toHaveBeenCalledOnce();
  });

  it("registers all four hook types on each api", async () => {
    const plugin = (await import("../index")).default;
    const api = mockApi("test");

    plugin.register!(api as never);

    const hookNames = api.on.mock.calls.map((c: unknown[]) => c[0]);
    expect(hookNames).toContain("before_tool_call");
    expect(hookNames).toContain("after_tool_call");
    expect(hookNames).toContain("session_start");
    expect(hookNames).toContain("session_end");
    expect(hookNames).toHaveLength(4);
  });
});

// Issue #77 — three coupled lifecycle bugs. Each contract below would have
// failed against the pre-fix code: module-lifetime _serviceRegistered gate
// (service + dashboard never re-bound on hot reload), missing config refresh
// in the else branch of register() (live toggles ignored until full gateway
// restart), and lack of an SSE teardown hook (listener leak on reload).
describe("index.ts register() — hot reload lifecycle (issue #77)", () => {
  beforeEach(() => {
    vi.resetModules();
    tearDownSseConnectionsSpy.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("contract 2: hot reload re-registers service + CLI + dashboard on a fresh api object", async () => {
    // Pre-fix bug: _serviceRegistered was a module-level boolean. After the
    // first register(api1) it stayed true forever, so every subsequent
    // register(api2) from OpenClaw's hot-reload path skipped the
    // registerService/registerCli/registerDashboardRoutes block — leaving
    // /plugins/clawlens/* returning 404 against the new registry.
    const plugin = (await import("../index")).default;
    const { registerDashboardRoutes } = await import("../src/dashboard/routes");
    const api1 = mockApi("registry-A");
    const api2 = mockApi("registry-B"); // simulates new registry after hot reload

    plugin.register!(api1 as never);
    plugin.register!(api2 as never);

    expect(api1.registerService).toHaveBeenCalledOnce();
    expect(api1.registerCli).toHaveBeenCalledOnce();
    expect(api2.registerService).toHaveBeenCalledOnce();
    expect(api2.registerCli).toHaveBeenCalledOnce();

    // registerDashboardRoutes must be invoked once per fresh api so the
    // route handler closure captures the latest deps (config + provider).
    expect(registerDashboardRoutes).toHaveBeenCalledTimes(2);
    const apiArgs = (registerDashboardRoutes as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0],
    );
    expect(apiArgs[0]).toBe(api1);
    expect(apiArgs[1]).toBe(api2);
  });

  it("contract 2 (cleanup): drops SSE listeners from the prior registry before binding the new one", async () => {
    // Pre-fix the SSE handler's per-request cleanup is correct in steady
    // state but in-flight clients survive a plugin reload — their
    // listeners stay attached to the process-singleton AuditLogger until
    // Node's MaxListeners=10 warning fires. tearDownSseConnections() must
    // run at the top of every register() before the new dashboard routes
    // get bound.
    const plugin = (await import("../index")).default;
    const api1 = mockApi("registry-A");
    const api2 = mockApi("registry-B");

    plugin.register!(api1 as never);
    expect(tearDownSseConnectionsSpy).toHaveBeenCalledTimes(1);

    plugin.register!(api2 as never);
    expect(tearDownSseConnectionsSpy).toHaveBeenCalledTimes(2);
  });

  it("contract 3: config toggle on second register() propagates into the deps passed to dashboard routes", async () => {
    // Pre-fix the else branch of register() only refreshed runtime + provider
    // + logger — never config or openClawConfig. So toggling
    // risk.llmEnabled (or any other config field) had no effect on running
    // handlers until the gateway was fully restarted.
    const { resolveConfig } = await import("../src/config");
    const { registerDashboardRoutes } = await import("../src/dashboard/routes");

    const configBefore = {
      auditLogPath: "/tmp/test-audit.jsonl",
      retention: "30d",
      digest: { schedule: "daily" },
      risk: {
        llmEvalThreshold: 50,
        llmEnabled: false,
        llmModel: "",
        llmApiKeyEnv: "ANTHROPIC_API_KEY",
        llmProvider: "anthropic",
      },
      alerts: { enabled: false, threshold: 80 },
    };
    const configAfter = {
      ...configBefore,
      risk: { ...configBefore.risk, llmEnabled: true },
    };
    (resolveConfig as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(configBefore)
      .mockReturnValueOnce(configAfter);

    const plugin = (await import("../index")).default;
    const api1 = mockApi("registry-A");
    const api2 = mockApi("registry-B");

    plugin.register!(api1 as never);
    plugin.register!(api2 as never);

    const calls = (registerDashboardRoutes as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(2);
    const depsAfterFirst = calls[0][1] as { config: typeof configBefore };
    const depsAfterSecond = calls[1][1] as { config: typeof configAfter };
    expect(depsAfterFirst.config.risk.llmEnabled).toBe(false);
    expect(depsAfterSecond.config.risk.llmEnabled).toBe(true);
  });

  it("contract 3 (openClawConfig): refreshes openClawConfig on subsequent register() so summary endpoint sees the live api.config", async () => {
    // Companion to the config field: openClawConfig is a separate dep that
    // closes over api.config and is passed to the LLM evaluator + session
    // summarizer. It must also be refreshed in the else branch.
    const { registerDashboardRoutes } = await import("../src/dashboard/routes");
    const plugin = (await import("../index")).default;

    const api1 = mockApi("registry-A");
    api1.config = { auth: { profiles: { p: { provider: "anthropic" } } } };
    const api2 = mockApi("registry-B");
    api2.config = {
      auth: { profiles: { p: { provider: "openai" } } },
      // A new key only present on the second registry — proves the deps
      // captured the live api.config rather than the stale first one.
      hotReloaded: true,
    };

    plugin.register!(api1 as never);
    plugin.register!(api2 as never);

    const calls = (registerDashboardRoutes as ReturnType<typeof vi.fn>).mock.calls;
    const depsAfterFirst = calls[0][1] as { openClawConfig: Record<string, unknown> };
    const depsAfterSecond = calls[1][1] as { openClawConfig: Record<string, unknown> };
    expect(depsAfterFirst.openClawConfig).toBe(api1.config);
    expect(depsAfterSecond.openClawConfig).toBe(api2.config);
    expect(depsAfterSecond.openClawConfig.hotReloaded).toBe(true);
  });
});
