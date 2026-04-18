import type { AuditLogger } from "../audit/logger";
import type { ClawLensConfig } from "../config";
import { GuardrailStore } from "../guardrails/store";
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
}
export declare function registerDashboardRoutes(api: OpenClawPluginApi, deps: DashboardDeps): void;
