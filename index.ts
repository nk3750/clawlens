import * as fs from "node:fs";
import * as path from "node:path";
import { exportToCSV, exportToJSON } from "./src/audit/exporter.js";
import { type AuditLogger, getAuditLogger } from "./src/audit/logger.js";
import { resolveConfig } from "./src/config.js";
import { AttentionStore } from "./src/dashboard/attention-state.js";
import { registerDashboardRoutes, tearDownSseConnections } from "./src/dashboard/routes.js";
import { GuardrailStore } from "./src/guardrails/store.js";
import { createAfterToolCallHandler } from "./src/hooks/after-tool-call.js";
import {
  type BeforeToolCallDeps,
  createBeforeToolCallHandler,
} from "./src/hooks/before-tool-call.js";
import { PendingApprovalStore } from "./src/hooks/pending-approval-store.js";
import { createSessionEndHandler } from "./src/hooks/session-end.js";
import { createSessionStartHandler } from "./src/hooks/session-start.js";
import { EvalCache } from "./src/risk/eval-cache.js";
import { SavedSearchesStore } from "./src/risk/saved-searches-store.js";
import { SessionContext } from "./src/risk/session-context.js";
import type {
  EmbeddedAgentRuntime,
  ModelAuth,
  OpenClawPluginApi,
  OpenClawPluginDefinition,
} from "./src/types.js";

// Pure helper: produces the JSON snippet `clawlens init` prints for users who
// install via the source-clone path (Channel 4) and want to wire ClawLens into
// `~/.openclaw/openclaw.json` manually. Exported for unit testing — see
// tests/clawlens-init-cli.test.ts.
export function buildInitConfigSnippet(opts: { pluginDir: string; auditLogPath: string }): string {
  return JSON.stringify(
    {
      plugins: {
        load: { paths: [opts.pluginDir] },
        entries: {
          clawlens: {
            enabled: true,
            config: {
              auditLogPath: opts.auditLogPath,
            },
          },
        },
      },
    },
    null,
    2,
  );
}

// ── Module-level state ──────────────────────────────────────────────────────
// Components + handler created once. Hooks + service + CLI + dashboard routes
// register per unique api object: OpenClaw dispatches through different api
// contexts and, on hot reload, swaps in a fresh api representing the new
// plugin registry. Pre-#77 a module-lifetime _serviceRegistered boolean
// gated the service/CLI/dashboard registrations, which meant hot reloads
// got "Plugin registered" but never "Service started" and /plugins/clawlens
// returned 404. The WeakSets below replace that gate with per-api tracking
// so each fresh registry gets a clean bind, and `replaceExisting: true` on
// registerHttpRoute lets the gateway swap the dashboard handler safely.
let _handlerDeps: BeforeToolCallDeps | undefined;
let _attentionStore: AttentionStore | undefined;
let _pendingApprovalStore: PendingApprovalStore | undefined;
let _savedSearchesStore: SavedSearchesStore | undefined;
// biome-ignore lint/suspicious/noExplicitAny: OpenClaw api identity tracking
const _hookedApis = new WeakSet<any>();
// biome-ignore lint/suspicious/noExplicitAny: OpenClaw api identity tracking
const _registeredApis = new WeakSet<any>();
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
  description:
    "Agent observability and guardrails for OpenClaw — risk scoring, audit trails, dashboard",
  version: "1.0.1",

  register(api: OpenClawPluginApi) {
    // Hot-reload safety: drain any SSE listeners still attached to the
    // process-singleton AuditLogger from the prior plugin registry. Without
    // this, a sustained reload pattern (toggle config N times) accumulates
    // leaked 'entry' listeners on the AuditLogger EventEmitter until Node
    // logs MaxListenersExceededWarning. Idempotent — first call sees an
    // empty registry and returns 0. Issue #77.
    tearDownSseConnections();

    const config = resolveConfig(api.pluginConfig, api.resolvePath);

    // Resolve runtime from OpenClaw plugin API (may differ per session)
    const runtime = (api as unknown as Record<string, unknown>).runtime as
      | { agent?: Record<string, unknown>; modelAuth?: ModelAuth }
      | undefined;

    // Resolve provider from OpenClaw auth config (e.g., "anthropic"). v1.0.1
    // removed the `risk.llmProvider` override; provider comes only from
    // OpenClaw's auth profiles when LLM evaluation is explicitly opted in.
    const authProfiles = (
      (api.config as Record<string, unknown>).auth as
        | { profiles?: Record<string, { provider?: string }> }
        | undefined
    )?.profiles;
    const provider = authProfiles
      ? Object.values(authProfiles).find((p) => p.provider)?.provider
      : undefined;

    const typedRuntime = runtime as
      | {
          agent?: EmbeddedAgentRuntime;
          modelAuth?: ModelAuth;
        }
      | undefined;

    // ── First call: create all components and handler instances ──
    if (!_handlerDeps) {
      const auditLogger = getAuditLogger(config.auditLogPath);
      const sessionContext = new SessionContext();
      const evalCache = new EvalCache();
      const guardrailStore = new GuardrailStore(config.guardrailsPath);
      guardrailStore.load();
      _attentionStore = new AttentionStore(config.attentionStatePath);
      _pendingApprovalStore = new PendingApprovalStore();
      _savedSearchesStore = new SavedSearchesStore(config.savedSearchesPath);
      _savedSearchesStore.load();

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
        pendingApprovalStore: _pendingApprovalStore,
      };

      // Create handler instances once — reused across api registrations
      _beforeToolCallHandler = createBeforeToolCallHandler(_handlerDeps);
      _afterToolCallHandler = createAfterToolCallHandler(auditLogger);
      _sessionStartHandler = createSessionStartHandler(auditLogger, api.logger);
      _sessionEndHandler = createSessionEndHandler(auditLogger, config, api.logger, sessionContext);
    } else {
      // Subsequent init (hot reload). Pre-#77 only refreshed runtime/
      // provider/logger; config + openClawConfig stayed pointing at the
      // first-call snapshot, so toggling risk.llmEnabled etc. had no effect
      // on running handlers until a full gateway restart. Refresh both
      // here — handler closures hold _handlerDeps by reference, so live
      // mutation propagates to them without re-creating the handler.
      _handlerDeps.runtime = typedRuntime;
      _handlerDeps.provider = provider;
      _handlerDeps.logger = api.logger;
      _handlerDeps.config = config;
      _handlerDeps.openClawConfig = api.config as Record<string, unknown>;
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

    // ── Per-api registrations: service, CLI, dashboard ──
    // Each fresh api (e.g. a new registry after OpenClaw hot reload) gets
    // its own service start hook + CLI commands + dashboard route binding.
    // Within one api, the WeakSet keeps us from double-binding (which the
    // gateway tolerates today but is wasted work and risks future churn).
    if (!_registeredApis.has(api)) {
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
              buildInitConfigSnippet({
                pluginDir: path.join(import.meta.dirname, ".."),
                auditLogPath: config.auditLogPath,
              }),
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
        // Compiled-from-dist (tarball install) puts this file in <root>/dist/, so we
        // need to walk up one. Source-loaded mode (the OpenClaw loader reads the
        // .ts directly per installs.json) already lands at <root>; walking up
        // overshoots into the parent directory and the SPA static block in
        // routes.ts falls through to the v1 placeholder. Pick by checking the
        // basename so both modes resolve the same package root.
        pluginDir:
          path.basename(import.meta.dirname) === "dist"
            ? path.join(import.meta.dirname, "..")
            : import.meta.dirname,
        config,
        modelAuth: runtime?.modelAuth,
        provider,
        agent: typedRuntime?.agent,
        openClawConfig: api.config as Record<string, unknown>,
        guardrailStore: grStore as GuardrailStore,
        attentionStore: _attentionStore,
        pendingApprovalStore: _pendingApprovalStore,
        savedSearchesStore: _savedSearchesStore,
      });

      _registeredApis.add(api);
    }

    api.logger.info("ClawLens: Plugin registered");
  },
};

export default plugin;
