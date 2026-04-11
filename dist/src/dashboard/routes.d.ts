import type { AuditLogger } from "../audit/logger";
import type { ClawLensConfig } from "../config";
import { GuardrailStore } from "../guardrails/store";
import type { EmbeddedAgentRuntime, ModelAuth, OpenClawPluginApi } from "../types";
export interface DashboardDeps {
    auditLogger: AuditLogger;
    pluginDir?: string;
    config?: ClawLensConfig;
    modelAuth?: ModelAuth;
    provider?: string;
    agent?: EmbeddedAgentRuntime;
    openClawConfig?: Record<string, unknown>;
    guardrailStore?: GuardrailStore;
}
export declare function registerDashboardRoutes(api: OpenClawPluginApi, deps: DashboardDeps): void;
