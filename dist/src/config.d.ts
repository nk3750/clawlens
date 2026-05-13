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
        /**
         * Opt-in LLM risk evaluation. Default false in v1.0.1 (local-safe
         * baseline). When true, ClawLens sends sanitized tool-call metadata to the
         * user's configured OpenClaw LLM provider via OpenClaw's existing
         * model/auth runtime. ClawLens does not read LLM API keys from env vars.
         */
        llmEnabled: boolean;
    };
    alerts: {
        enabled: boolean;
        threshold: number;
        /**
         * When false (default), alert messages omit command/url/path values and
         * carry a "redacted by default" details line. Set to true to opt into
         * including parameter detail in alert payloads; redaction of credential
         * patterns still applies upstream.
         */
        includeParamValues: boolean;
        quietHoursStart?: string;
        quietHoursEnd?: string;
    };
    dashboardUrl?: string;
}
export declare const DEFAULT_CONFIG: ClawLensConfig;
export declare function resolveConfig(pluginConfig?: Record<string, unknown>, resolvePath?: (input: string) => string): ClawLensConfig;
