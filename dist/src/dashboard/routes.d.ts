import type { AuditLogger } from "../audit/logger";
import type { ClawLensConfig } from "../config";
import type { PolicyEngine } from "../policy/engine";
import type { ModelAuth, OpenClawPluginApi } from "../types";
export interface DashboardDeps {
    engine: PolicyEngine;
    auditLogger: AuditLogger;
    pluginDir?: string;
    config?: ClawLensConfig;
    modelAuth?: ModelAuth;
    provider?: string;
}
export declare function registerDashboardRoutes(api: OpenClawPluginApi, deps: DashboardDeps): void;
