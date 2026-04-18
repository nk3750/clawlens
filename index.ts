import * as fs from "node:fs";
import * as path from "node:path";
import { exportToCSV, exportToJSON } from "./src/audit/exporter";
import { AuditLogger } from "./src/audit/logger";
import { resolveConfig } from "./src/config";
import { AttentionStore } from "./src/dashboard/attention-state";
import { registerDashboardRoutes } from "./src/dashboard/routes";
import { GuardrailStore } from "./src/guardrails/store";
import { createAfterToolCallHandler } from "./src/hooks/after-tool-call";
import { type BeforeToolCallDeps, createBeforeToolCallHandler } from "./src/hooks/before-tool-call";
import { createSessionEndHandler } from "./src/hooks/session-end";
import { createSessionStartHandler } from "./src/hooks/session-start";
import { EvalCache } from "./src/risk/eval-cache";
import { SessionContext } from "./src/risk/session-context";
import type {
  EmbeddedAgentRuntime,
  ModelAuth,
  OpenClawPluginApi,
  OpenClawPluginDefinition,
} from "./src/types";

// ── Module-level state ──────────────────────────────────────────────────────
// Components + handler created once. Hooks registered per unique api object
// (gateway dispatches tool calls through different api contexts).
let _handlerDeps: BeforeToolCallDeps | undefined;
let _attentionStore: AttentionStore | undefined;
let _serviceRegistered = false;
// biome-ignore lint/suspicious/noExplicitAny: OpenClaw api identity tracking
const _hookedApis = new WeakSet<any>();
// biome-ignore lint/suspicious/noExplicitAny: handler refs shared across api registrations
let _beforeToolCallHandler: (...args: any[]) => any;
// biome-ignore lint/suspicious/noExplicitAny: handler refs shared across api registrations
let _afterToolCallHandler: (...args: any[]) => any;
// biome-ignore lint/suspicious/noExplicitAny: handler refs shared across api registrations
let _sessionStartHandler: (...args: any[]) => any;
// biome-ignore lint/suspicious/noExplicitAny: handler refs shared across api registrations
let _sessionEndHandler: (...args: any[]) => any;

const plugin: OpenClawPluginDefinition = {
  id: "clawlens",
  name: "ClawLens",
  description: "Agent governance — risk scoring, audit trails, and observability",
  version: "0.3.0",

  register(api: OpenClawPluginApi) {
    const config = resolveConfig(api.pluginConfig, api.resolvePath);

    // Resolve runtime from OpenClaw plugin API (may differ per session)
    const runtime = (api as unknown as Record<string, unknown>).runtime as
      | { agent?: Record<string, unknown>; modelAuth?: ModelAuth }
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
          agent?: EmbeddedAgentRuntime;
          modelAuth?: ModelAuth;
        }
      | undefined;

    // ── First call: create all components and handler instances ──
    if (!_handlerDeps) {
      const auditLogger = new AuditLogger(config.auditLogPath);
      const sessionContext = new SessionContext();
      const evalCache = new EvalCache();
      const guardrailStore = new GuardrailStore(config.guardrailsPath);
      guardrailStore.load();
      _attentionStore = new AttentionStore(config.attentionStatePath);

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

      _handlerDeps = {
        auditLogger,
        config,
        sessionContext,
        guardrailStore,
        evalCache,
        alertSend,
        logger: api.logger,
        runtime: typedRuntime,
        provider,
        openClawConfig: api.config as Record<string, unknown>,
      };

      // Create handler instances once — reused across api registrations
      _beforeToolCallHandler = createBeforeToolCallHandler(_handlerDeps);
      _afterToolCallHandler = createAfterToolCallHandler(auditLogger);
      _sessionStartHandler = createSessionStartHandler(auditLogger, api.logger);
      _sessionEndHandler = createSessionEndHandler(auditLogger, config, api.logger, sessionContext);
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
      api.on("session_start", _sessionStartHandler);
      api.on("session_end", _sessionEndHandler);
      _hookedApis.add(api);
    }

    // ── One-time registrations: service, CLI, dashboard ──
    if (!_serviceRegistered) {
      const { auditLogger, evalCache, guardrailStore: grStore } = _handlerDeps;

      api.registerService({
        id: "clawlens",
        start: async () => {
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

          api.logger.info("ClawLens: Service started");
        },
        stop: async () => {
          await (auditLogger as AuditLogger).flush();
          api.logger.info("ClawLens: Service stopped");
        },
      });

      api.registerCli((cli) => {
        cli
          .command("clawlens init")
          .description("Initialize ClawLens data directory and show config snippet")
          .action(async () => {
            const dataDir = path.dirname(config.auditLogPath);

            if (!fs.existsSync(dataDir)) {
              fs.mkdirSync(dataDir, { recursive: true });
              console.log(`Created data directory: ${dataDir}`);
            } else {
              console.log(`Data directory already exists: ${dataDir}`);
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
        auditLogger: auditLogger as AuditLogger,
        pluginDir: __dirname,
        config,
        modelAuth: runtime?.modelAuth,
        provider,
        agent: typedRuntime?.agent,
        openClawConfig: api.config as Record<string, unknown>,
        guardrailStore: grStore as GuardrailStore,
        attentionStore: _attentionStore,
      });

      _serviceRegistered = true;
    }

    api.logger.info("ClawLens: Plugin registered");
  },
};

export default plugin;
