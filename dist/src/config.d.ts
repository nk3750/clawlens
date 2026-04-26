export interface ClawLensConfig {
    auditLogPath: string;
    guardrailsPath: string;
    attentionStatePath: string;
    savedSearchesPath: string;
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
