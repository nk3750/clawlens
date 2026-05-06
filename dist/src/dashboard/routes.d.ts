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
export declare function registerDashboardRoutes(api: OpenClawPluginApi, deps: DashboardDeps): void;
