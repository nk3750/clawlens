import * as fs from "node:fs";
import * as path from "node:path";
import { exportToCSV, exportToJSON } from "./src/audit/exporter";
import { AuditLogger } from "./src/audit/logger";
import { resolveConfig } from "./src/config";
import { registerDashboardRoutes } from "./src/dashboard/routes";
import { createAfterToolCallHandler } from "./src/hooks/after-tool-call";
import { createBeforePromptBuildHandler } from "./src/hooks/before-prompt-build";
import { type BeforeToolCallDeps, createBeforeToolCallHandler } from "./src/hooks/before-tool-call";
import { createSessionEndHandler } from "./src/hooks/session-end";
import { createSessionStartHandler } from "./src/hooks/session-start";
import { PolicyEngine } from "./src/policy/engine";
import { PolicyLoader } from "./src/policy/loader";
import { RateLimiter } from "./src/rate/limiter";
import { EvalCache } from "./src/risk/eval-cache";
import { SessionContext } from "./src/risk/session-context";
import type { ModelAuth, OpenClawPluginApi, OpenClawPluginDefinition } from "./src/types";

// ── Module-level state ──────────────────────────────────────────────────────
// Components + handler created once. Hooks registered per unique api object
// (gateway dispatches tool calls through different api contexts).
let _handlerDeps: BeforeToolCallDeps | undefined;
let _serviceRegistered = false;
// biome-ignore lint/suspicious/noExplicitAny: OpenClaw api identity tracking
const _hookedApis = new WeakSet<any>();
// biome-ignore lint/suspicious/noExplicitAny: handler refs shared across api registrations
let _beforeToolCallHandler: (...args: any[]) => any;
// biome-ignore lint/suspicious/noExplicitAny: handler refs shared across api registrations
let _afterToolCallHandler: (...args: any[]) => any;
// biome-ignore lint/suspicious/noExplicitAny: handler refs shared across api registrations
let _beforePromptBuildHandler: (...args: any[]) => any;
// biome-ignore lint/suspicious/noExplicitAny: handler refs shared across api registrations
let _sessionStartHandler: (...args: any[]) => any;
// biome-ignore lint/suspicious/noExplicitAny: handler refs shared across api registrations
let _sessionEndHandler: (...args: any[]) => any;

const plugin: OpenClawPluginDefinition = {
  id: "clawlens",
  name: "ClawLens",
  description: "Agent governance — policy enforcement, approval flows, and audit trails",
  version: "0.2.0",

  register(api: OpenClawPluginApi) {
    const config = resolveConfig(api.pluginConfig, api.resolvePath);

    // Resolve runtime from OpenClaw plugin API (may differ per session)
    const runtime = (api as unknown as Record<string, unknown>).runtime as
      | { subagent?: Record<string, unknown>; modelAuth?: ModelAuth }
      | undefined;

    // Resolve provider from OpenClaw auth config (e.g., "anthropic")
    const authProfiles = (
      (api.config as Record<string, unknown>).auth as
        | { profiles?: Record<string, { provider?: string }> }
        | undefined
    )?.profiles;
    const detectedProvider = authProfiles
      ? Object.values(authProfiles).find((p) => p.provider)?.provider
      : undefined;
    const provider = detectedProvider || config.risk.llmProvider;

    const typedRuntime = runtime as
      | {
          subagent?: {
            run?: (opts: unknown) => Promise<unknown>;
            waitForRun?: (opts: unknown) => Promise<unknown>;
            getSessionMessages?: (opts: unknown) => Promise<unknown>;
            deleteSession?: (opts: unknown) => Promise<void>;
          };
          modelAuth?: ModelAuth;
        }
      | undefined;

    // ── First call: create all components and handler instances ──
    if (!_handlerDeps) {
      const engine = new PolicyEngine();
      const loader = new PolicyLoader(engine, config.policiesPath, api.logger);
      const auditLogger = new AuditLogger(config.auditLogPath);
      const rateLimiter = new RateLimiter(config.rateStatePath);
      const sessionContext = new SessionContext();
      const evalCache = new EvalCache();

      // Alert send function — uses gateway method if available
      let alertSend: ((msg: string) => Promise<void> | void) | undefined;
      try {
        api.registerGatewayMethod("clawlens.alert", (msg: unknown) => {
          api.logger.info(`ClawLens Alert: ${String(msg)}`);
        });
        alertSend = (msg: string) => {
          api.logger.info(`ClawLens Alert:\n${msg}`);
        };
      } catch {
        // Gateway method registration may not be available — alerts degrade to logs
        alertSend = (msg: string) => {
          api.logger.warn(`ClawLens Alert (no gateway):\n${msg}`);
        };
      }

      // Load policy eagerly so hooks work even if service.start() hasn't run yet
      try {
        loader.load();
      } catch (err) {
        api.logger.warn(
          `ClawLens: Failed to load policy during register: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      _handlerDeps = {
        engine,
        auditLogger,
        rateLimiter,
        config,
        sessionContext,
        evalCache,
        alertSend,
        logger: api.logger,
        runtime: typedRuntime,
        provider,
      };

      // Create handler instances once — reused across api registrations
      _beforeToolCallHandler = createBeforeToolCallHandler(_handlerDeps);
      _afterToolCallHandler = createAfterToolCallHandler(auditLogger, rateLimiter);
      _beforePromptBuildHandler = createBeforePromptBuildHandler(engine);
      _sessionStartHandler = createSessionStartHandler(
        engine,
        loader,
        auditLogger,
        rateLimiter,
        api.logger,
      );
      _sessionEndHandler = createSessionEndHandler(
        auditLogger,
        rateLimiter,
        config,
        api.logger,
        sessionContext,
      );
    } else {
      // Subsequent init: refresh session-scoped state on shared deps
      _handlerDeps.runtime = typedRuntime;
      _handlerDeps.provider = provider;
      _handlerDeps.logger = api.logger;
    }

    // ── Register hooks on each unique api object ──
    // Gateway dispatches tool calls through different api contexts;
    // hooks must be wired on each to ensure they fire.
    if (!_hookedApis.has(api)) {
      api.on("before_tool_call", _beforeToolCallHandler, { priority: 100 });
      api.on("after_tool_call", _afterToolCallHandler);
      api.on("before_prompt_build", _beforePromptBuildHandler);
      api.on("session_start", _sessionStartHandler);
      api.on("session_end", _sessionEndHandler);
      _hookedApis.add(api);
    }

    // ── One-time registrations: service, CLI, dashboard ──
    if (!_serviceRegistered) {
      const { engine, auditLogger, rateLimiter, evalCache } = _handlerDeps;
      const loader = new PolicyLoader(engine as PolicyEngine, config.policiesPath, api.logger);

      api.registerService({
        id: "clawlens",
        start: async () => {
          if (!(engine as PolicyEngine).getPolicy()) {
            loader.load();
          }
          await (auditLogger as AuditLogger).init();

          // Pre-warm eval cache from audit log entries with real LLM evaluations
          try {
            const entries = (auditLogger as AuditLogger).readEntries();
            const warmed = (evalCache as EvalCache).warmFromAuditLog(entries);
            if (warmed > 0) {
              api.logger.info(`ClawLens: Pre-warmed eval cache with ${warmed} entries`);
            }
          } catch (err) {
            api.logger.warn(
              `ClawLens: Cache pre-warming failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }

          (rateLimiter as RateLimiter).restore();
          loader.startWatching();
          api.logger.info("ClawLens: Service started");
        },
        stop: async () => {
          loader.stopWatching();
          await (auditLogger as AuditLogger).flush();
          (rateLimiter as RateLimiter).persist();
          (rateLimiter as RateLimiter).cleanup();
          api.logger.info("ClawLens: Service stopped");
        },
      });

      api.registerCli((cli) => {
        cli
          .command("clawlens init")
          .description("Initialize ClawLens with default config and policies")
          .action(async () => {
            const configDir = path.dirname(config.policiesPath);

            if (!fs.existsSync(configDir)) {
              fs.mkdirSync(configDir, { recursive: true });
            }

            if (!fs.existsSync(config.policiesPath)) {
              const defaultPolicy = path.join(__dirname, "policies", "standard.yaml");
              if (fs.existsSync(defaultPolicy)) {
                fs.copyFileSync(defaultPolicy, config.policiesPath);
              } else {
                fs.writeFileSync(
                  config.policiesPath,
                  `${[
                    'version: "1"',
                    "",
                    "defaults:",
                    "  unknown_actions: approval_required",
                    "  approval_timeout: 300",
                    "  timeout_action: deny",
                    "  digest: daily",
                    "",
                    "rules:",
                    '  - name: "Block rm -rf"',
                    "    match:",
                    "      tool: exec",
                    "      params:",
                    '        command: "*rm -rf*"',
                    "    action: block",
                    '    reason: "Destructive command blocked"',
                    "",
                    '  - name: "Approve shell commands"',
                    "    match:",
                    "      tool: exec",
                    "    action: approval_required",
                    "",
                    '  - name: "Allow reads"',
                    "    match:",
                    "      tool: read",
                    "    action: allow",
                    "",
                    '  - name: "Default"',
                    "    match: {}",
                    "    action: approval_required",
                  ].join("\n")}\n`,
                );
              }
              console.log(`ClawLens initialized. Edit policies at ${config.policiesPath}`);
            } else {
              console.log(`Policies already exist at ${config.policiesPath} — skipping.`);
            }

            console.log("\nTo enable ClawLens, add to ~/.openclaw/openclaw.json:");
            console.log(
              JSON.stringify(
                {
                  plugins: {
                    load: { paths: ["~/code/clawLens"] },
                    entries: {
                      clawlens: {
                        enabled: true,
                        config: {
                          policiesPath: config.policiesPath,
                          auditLogPath: config.auditLogPath,
                        },
                      },
                    },
                  },
                },
                null,
                2,
              ),
            );
          });

        cli
          .command("clawlens audit export")
          .description("Export audit log")
          .option("--format <format>", "json or csv", "json")
          .option("--since <duration>", "time range, e.g. 7d, 24h, 1h")
          .action(async (opts: Record<string, unknown>) => {
            const format = (opts.format as string) || "json";
            const since = opts.since as string | undefined;

            const entries = (auditLogger as AuditLogger).readEntries();

            if (format === "csv") {
              console.log(exportToCSV(entries, since));
            } else {
              console.log(exportToJSON(entries, since));
            }
          });
      });

      registerDashboardRoutes(api, {
        engine: engine as PolicyEngine,
        auditLogger: auditLogger as AuditLogger,
        pluginDir: __dirname,
        config,
        modelAuth: runtime?.modelAuth,
        provider,
      });

      _serviceRegistered = true;
    }

    api.logger.info("ClawLens: Plugin registered");
  },
};

export default plugin;
