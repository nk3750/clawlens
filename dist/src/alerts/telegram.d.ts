import type { Guardrail } from "../guardrails/types";
import type { AlertConfig, RiskScore } from "../risk/types";
/**
 * Check whether an alert should fire for the given score and config.
 * Respects quiet hours (evaluated against local system time).
 */
export declare function shouldAlert(score: number, config: AlertConfig): boolean;
/**
 * Format an alert message for Telegram delivery.
 */
export declare function formatAlert(toolName: string, params: Record<string, unknown>, riskScore: RiskScore, dashboardUrl: string): string;
/**
 * Format an allow_notify alert. Distinct from formatAlert via the
 * "[guardrail allow_notify]" prefix so operators on a single Telegram
 * channel can tell it apart from risk-score alerts. The matched rule's
 * note (operator-supplied) is included when present.
 */
export declare function formatGuardrailNotifyAlert(guardrail: Guardrail, toolName: string, params: Record<string, unknown>): string;
/**
 * Send an alert via a gateway method. The caller provides the send function
 * (registered via api.registerGatewayMethod) to keep this module decoupled
 * from the plugin API.
 */
export declare function sendAlert(message: string, send: (msg: string) => Promise<void> | void): Promise<void>;
