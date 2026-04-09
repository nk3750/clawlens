import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock all heavy dependencies so we can test registration logic in isolation
vi.mock("../src/audit/logger", () => ({
  AuditLogger: vi.fn().mockImplementation(() => ({
    init: vi.fn(),
    readEntries: vi.fn().mockReturnValue([]),
    flush: vi.fn(),
    logDecision: vi.fn(),
    appendEvaluation: vi.fn(),
  })),
}));

vi.mock("../src/policy/engine", () => ({
  PolicyEngine: vi.fn().mockImplementation(() => ({
    load: vi.fn(),
    getPolicy: vi.fn().mockReturnValue(null),
    evaluate: vi.fn().mockReturnValue({ action: "allow" }),
  })),
}));

vi.mock("../src/policy/loader", () => ({
  PolicyLoader: vi.fn().mockImplementation(() => ({
    load: vi.fn(),
    startWatching: vi.fn(),
    stopWatching: vi.fn(),
  })),
}));

vi.mock("../src/rate/limiter", () => ({
  RateLimiter: vi.fn().mockImplementation(() => ({
    getCount: vi.fn().mockReturnValue(0),
    record: vi.fn(),
    restore: vi.fn(),
    persist: vi.fn(),
    cleanup: vi.fn(),
  })),
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

vi.mock("../src/dashboard/routes", () => ({
  registerDashboardRoutes: vi.fn(),
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

vi.mock("../src/hooks/before-prompt-build", () => ({
  createBeforePromptBuildHandler: vi.fn().mockReturnValue(vi.fn()),
}));

vi.mock("../src/hooks/session-start", () => ({
  createSessionStartHandler: vi.fn().mockReturnValue(vi.fn()),
}));

vi.mock("../src/hooks/session-end", () => ({
  createSessionEndHandler: vi.fn().mockReturnValue(vi.fn()),
}));

vi.mock("../src/config", () => ({
  resolveConfig: vi.fn().mockReturnValue({
    mode: "observe",
    policiesPath: "/tmp/test-policies.yaml",
    auditLogPath: "/tmp/test-audit.jsonl",
    rateStatePath: "/tmp/test-rate.json",
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

  it("registers service/CLI/dashboard only once across multiple apis", async () => {
    const plugin = (await import("../index")).default;
    const api1 = mockApi("gateway");
    const api2 = mockApi("plugins");

    plugin.register!(api1 as never);
    plugin.register!(api2 as never);

    // Service and CLI registered once (on first api)
    expect(api1.registerService).toHaveBeenCalledOnce();
    expect(api1.registerCli).toHaveBeenCalledOnce();
    expect(api2.registerService).not.toHaveBeenCalled();
    expect(api2.registerCli).not.toHaveBeenCalled();
  });

  it("registers all five hook types on each api", async () => {
    const plugin = (await import("../index")).default;
    const api = mockApi("test");

    plugin.register!(api as never);

    const hookNames = api.on.mock.calls.map((c: unknown[]) => c[0]);
    expect(hookNames).toContain("before_tool_call");
    expect(hookNames).toContain("after_tool_call");
    expect(hookNames).toContain("before_prompt_build");
    expect(hookNames).toContain("session_start");
    expect(hookNames).toContain("session_end");
    expect(hookNames).toHaveLength(5);
  });
});
