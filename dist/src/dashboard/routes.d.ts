import type { AuditLogger } from "../audit/logger.js";
import type { ClawLensConfig } from "../config.js";
import { GuardrailStore } from "../guardrails/store.js";
import type { PendingApprovalStore } from "../hooks/pending-approval-store.js";
import type { SavedSearchesStore } from "../risk/saved-searches-store.js";
import type { EmbeddedAgentRuntime, ModelAuth, OpenClawPluginApi } from "../types.js";
import { AttentionStore } from "./attention-state.js";
export interface DashboardDeps {
    auditLogger: AuditLogger;
    pluginDir?: string;
    config?: ClawLensConfig;
    modelAuth?: ModelAuth;
    provider?: string;
    agent?: EmbeddedAgentRuntime;
    openClawConfig?: Record<string, unknown>;
    guardrailStore?: GuardrailStore;
    attentionStore?: AttentionStore;
    pendingApprovalStore?: PendingApprovalStore;
    savedSearchesStore?: SavedSearchesStore;
}
/**
 * Tear down every active SSE connection: removes each per-connection 'entry'
 * listener from the AuditLogger it was attached to, ends each response if
 * not already ended, and clears the global registry. Returns the count of
 * connections drained.
 *
 * Called from the plugin's register() at the top of each invocation (so a
 * hot reload starts from a clean slate) and from the service stop hook.
 * Idempotent — invoking it on an empty registry returns 0 without throwing.
 */
export declare function tearDownSseConnections(): number;
export declare function registerDashboardRoutes(api: OpenClawPluginApi, deps: DashboardDeps): void;
