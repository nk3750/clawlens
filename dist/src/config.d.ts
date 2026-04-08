export interface ClawLensConfig {
    /** "observe" = score and log everything, never block. "enforce" = apply policy decisions. */
    mode: "observe" | "enforce";
    policiesPath: string;
    auditLogPath: string;
    rateStatePath: string;
    retention: string;
    digest: {
        schedule: string;
        channel?: string;
    };
    risk: {
        llmEvalThreshold: number;
        llmEnabled: boolean;
        llmModel: string;
        llmApiKeyEnv: string;
        /** Optional override — auto-detected from OpenClaw auth config if not set */
        llmProvider: string;
    };
    alerts: {
        enabled: boolean;
        threshold: number;
        quietHoursStart?: string;
        quietHoursEnd?: string;
    };
    dashboardUrl?: string;
}
export declare const DEFAULT_CONFIG: ClawLensConfig;
export declare function resolveConfig(pluginConfig?: Record<string, unknown>, resolvePath?: (input: string) => string): ClawLensConfig;
