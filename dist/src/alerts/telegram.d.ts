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
 * Send an alert via a gateway method. The caller provides the send function
 * (registered via api.registerGatewayMethod) to keep this module decoupled
 * from the plugin API.
 */
export declare function sendAlert(message: string, send: (msg: string) => Promise<void> | void): Promise<void>;
