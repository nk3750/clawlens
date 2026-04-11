import type { AuditLogger } from "../audit/logger";
import type { ClawLensConfig } from "../config";
import type { EmbeddedAgentRuntime, ModelAuth, OpenClawPluginApi } from "../types";
export interface DashboardDeps {
    auditLogger: AuditLogger;
    pluginDir?: string;
    config?: ClawLensConfig;
    modelAuth?: ModelAuth;
    provider?: string;
    agent?: EmbeddedAgentRuntime;
    openClawConfig?: Record<string, unknown>;
}
export declare function registerDashboardRoutes(api: OpenClawPluginApi, deps: DashboardDeps): void;
