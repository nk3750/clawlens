import type { Guardrail } from "../guardrails/types.js";
import type { AlertConfig, RiskScore } from "../risk/types.js";
/**
 * Check whether an alert should fire for the given score and config.
 * Respects quiet hours (evaluated against local system time).
 */
export declare function shouldAlert(score: number, config: AlertConfig): boolean;
export interface AlertFormatOptions {
    /**
     * When true, include per-param detail lines (Command/URL/Path/Action/To)
     * in the alert message. Default false (v1.0.1 local-safe baseline). Values
     * are still expected to be sanitized upstream via `src/privacy/redaction.ts`
     * before reaching this formatter.
     */
    includeParamValues?: boolean;
}
/**
 * Format a risk-alert message. By default emits a redacted summary without
 * command/url/path detail; callers can opt into full values via
 * `options.includeParamValues=true`.
 */
export declare function formatAlert(toolName: string, params: Record<string, unknown>, riskScore: RiskScore, dashboardUrl: string, options?: AlertFormatOptions): string;
/**
 * Format an allow_notify message. Mirrors formatAlert's default-redacted
 * behavior: the matched-rule note + tool name are included, but per-param
 * detail is only emitted when the caller opts in.
 */
export declare function formatGuardrailNotifyAlert(guardrail: Guardrail, toolName: string, params: Record<string, unknown>, options?: AlertFormatOptions): string;
/**
 * Send an alert via a gateway method. The caller provides the send function
 * (registered via api.registerGatewayMethod) to keep this module decoupled
 * from the plugin API.
 */
export declare function sendAlert(message: string, send: (msg: string) => Promise<void> | void): Promise<void>;
