import * as fs from "node:fs";
import * as path from "node:path";
import type { OpenClawPluginDefinition, OpenClawPluginApi } from "./src/types";
import { resolveConfig } from "./src/config";
import { PolicyEngine } from "./src/policy/engine";
import { PolicyLoader } from "./src/policy/loader";
import { AuditLogger } from "./src/audit/logger";
import { RateLimiter } from "./src/rate/limiter";
import { SessionContext } from "./src/risk/session-context";
import { EvalCache } from "./src/risk/eval-cache";
import { exportToJSON, exportToCSV } from "./src/audit/exporter";
import { createBeforeToolCallHandler } from "./src/hooks/before-tool-call";
import { createAfterToolCallHandler } from "./src/hooks/after-tool-call";
import { createBeforePromptBuildHandler } from "./src/hooks/before-prompt-build";
import { createSessionStartHandler } from "./src/hooks/session-start";
import { createSessionEndHandler } from "./src/hooks/session-end";
import { registerDashboardRoutes } from "./src/dashboard/routes";

const plugin: OpenClawPluginDefinition = {
  id: "clawlens",
  name: "ClawLens",
  description:
    "Agent governance — policy enforcement, approval flows, and audit trails",
  version: "0.2.0",

  register(api: OpenClawPluginApi) {
    const config = resolveConfig(api.pluginConfig, api.resolvePath);

    // Core components
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
    // (OpenClaw may call register() per-session but service.start() only once)
    try {
      loader.load();
    } catch (err) {
      api.logger.warn(
        `ClawLens: Failed to load policy during register: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Resolve runtime from OpenClaw plugin API (runtime.subagent used for async LLM eval)
    const runtime = (api as Record<string, unknown>).runtime as
      | { subagent?: Record<string, unknown> }
      | undefined;

    // Wire hooks
    api.on(
      "before_tool_call",
      createBeforeToolCallHandler({
        engine,
        auditLogger,
        rateLimiter,
        config,
        sessionContext,
        evalCache,
        alertSend,
        logger: api.logger,
        runtime: runtime as
          | {
              subagent?: {
                run?: (opts: unknown) => Promise<unknown>;
                waitForRun?: (opts: unknown) => Promise<unknown>;
                getSessionMessages?: (opts: unknown) => Promise<unknown>;
                deleteSession?: (opts: unknown) => Promise<void>;
              };
            }
          | undefined,
      }),
      { priority: 100 },
    );

    api.on(
      "after_tool_call",
      createAfterToolCallHandler(auditLogger, rateLimiter),
    );

    api.on("before_prompt_build", createBeforePromptBuildHandler(engine));

    api.on(
      "session_start",
      createSessionStartHandler(
        engine,
        loader,
        auditLogger,
        rateLimiter,
        api.logger,
      ),
    );

    api.on(
      "session_end",
      createSessionEndHandler(
        auditLogger,
        rateLimiter,
        config,
        api.logger,
        sessionContext,
      ),
    );

    // Register service for lifecycle management
    api.registerService({
      id: "clawlens",
      start: async () => {
        if (!engine.getPolicy()) {
          loader.load();
        }
        await auditLogger.init();

        // Pre-warm eval cache from audit log entries with real LLM evaluations
        try {
          const entries = auditLogger.readEntries();
          const warmed = evalCache.warmFromAuditLog(entries);
          if (warmed > 0) {
            api.logger.info(`ClawLens: Pre-warmed eval cache with ${warmed} entries`);
          }
        } catch (err) {
          api.logger.warn(
            `ClawLens: Cache pre-warming failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }

        rateLimiter.restore();
        loader.startWatching();
        api.logger.info("ClawLens: Service started");
      },
      stop: async () => {
        loader.stopWatching();
        await auditLogger.flush();
        rateLimiter.persist();
        rateLimiter.cleanup();
        api.logger.info("ClawLens: Service stopped");
      },
    });

    // Register CLI commands
    api.registerCli((cli) => {
      cli
        .command("clawlens init")
        .description("Initialize ClawLens with default config and policies")
        .action(async () => {
          const configDir = path.dirname(config.policiesPath);

          if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
          }

          // Copy standard policy to config location
          if (!fs.existsSync(config.policiesPath)) {
            const defaultPolicy = path.join(__dirname, "policies", "standard.yaml");
            if (fs.existsSync(defaultPolicy)) {
              fs.copyFileSync(defaultPolicy, config.policiesPath);
            } else {
              // Fallback: write a minimal default policy inline
              fs.writeFileSync(
                config.policiesPath,
                [
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
                ].join("\n") + "\n",
              );
            }
            console.log(
              `ClawLens initialized. Edit policies at ${config.policiesPath}`,
            );
          } else {
            console.log(
              `Policies already exist at ${config.policiesPath} — skipping.`,
            );
          }

          console.log(
            "\nTo enable ClawLens, add to ~/.openclaw/openclaw.json:",
          );
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

          const entries = auditLogger.readEntries();

          if (format === "csv") {
            console.log(exportToCSV(entries, since));
          } else {
            console.log(exportToJSON(entries, since));
          }
        });
    });

    // Dashboard
    registerDashboardRoutes(api, { engine, auditLogger, pluginDir: __dirname });

    api.logger.info("ClawLens: Plugin registered");
  },
};

export default plugin;
