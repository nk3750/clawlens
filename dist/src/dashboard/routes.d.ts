import type { AuditLogger } from "../audit/logger";
import type { ClawLensConfig } from "../config";
import { GuardrailStore } from "../guardrails/store";
import type { PendingApprovalStore } from "../hooks/pending-approval-store";
import type { SavedSearchesStore } from "../risk/saved-searches-store";
import type { EmbeddedAgentRuntime, ModelAuth, OpenClawPluginApi } from "../types";
import { AttentionStore } from "./attention-state";
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
