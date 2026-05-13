import type { Guardrail } from "../guardrails/types.js";
import type { AlertConfig, RiskScore } from "../risk/types.js";

/**
 * Check whether an alert should fire for the given score and config.
 * Respects quiet hours (evaluated against local system time).
 */
export function shouldAlert(score: number, config: AlertConfig): boolean {
  if (!config.enabled) return false;
  if (score < config.threshold) return false;

  if (config.quietHoursStart && config.quietHoursEnd) {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const startMinutes = parseTimeToMinutes(config.quietHoursStart);
    const endMinutes = parseTimeToMinutes(config.quietHoursEnd);

    if (startMinutes !== null && endMinutes !== null) {
      // Quiet hours can span midnight (e.g. 23:00 - 07:00)
      if (startMinutes > endMinutes) {
        if (currentMinutes >= startMinutes || currentMinutes < endMinutes) {
          return false;
        }
      } else {
        if (currentMinutes >= startMinutes && currentMinutes < endMinutes) {
          return false;
        }
      }
    }
  }

  return true;
}

function parseTimeToMinutes(time: string): number | null {
  const match = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
}

export interface AlertFormatOptions {
  /**
   * When true, include per-param detail lines (Command/URL/Path/Action/To)
   * in the alert message. Default false (v1.0.1 local-safe baseline). Values
   * are still expected to be sanitized upstream via `src/privacy/redaction.ts`
   * before reaching this formatter.
   */
  includeParamValues?: boolean;
}

const REDACTED_DETAILS_LINE = "Details: redacted by default. Open the local dashboard to inspect.";

/**
 * Format a risk-alert message. By default emits a redacted summary without
 * command/url/path detail; callers can opt into full values via
 * `options.includeParamValues=true`.
 */
export function formatAlert(
  toolName: string,
  params: Record<string, unknown>,
  riskScore: RiskScore,
  dashboardUrl: string,
  options: AlertFormatOptions = {},
): string {
  const includeValues = options.includeParamValues === true;
  const lines: string[] = [];
  lines.push("⚠️ ClawLens Risk Alert");
  lines.push("");

  lines.push(`Tool: ${toolName}`);

  if (includeValues) {
    appendParamDetailLines(lines, toolName, params);
  }

  lines.push(`Risk Score: ${riskScore.score} (${riskScore.tier})`);

  if (riskScore.tags.length > 0) {
    lines.push(`Tags: ${riskScore.tags.join(", ")}`);
  }

  if (!includeValues) {
    lines.push(REDACTED_DETAILS_LINE);
  }

  if (dashboardUrl) {
    lines.push("");
    lines.push(`View details: ${dashboardUrl}`);
  }

  return lines.join("\n");
}

/**
 * Format an allow_notify message. Mirrors formatAlert's default-redacted
 * behavior: the matched-rule note + tool name are included, but per-param
 * detail is only emitted when the caller opts in.
 */
export function formatGuardrailNotifyAlert(
  guardrail: Guardrail,
  toolName: string,
  params: Record<string, unknown>,
  options: AlertFormatOptions = {},
): string {
  const includeValues = options.includeParamValues === true;
  const lines: string[] = [];
  lines.push("[guardrail allow_notify]");
  lines.push(guardrail.description);
  lines.push("");
  lines.push(`Tool: ${toolName}`);

  if (includeValues) {
    appendParamDetailLines(lines, toolName, params);
  } else {
    lines.push(REDACTED_DETAILS_LINE);
  }

  if (guardrail.note) {
    lines.push("");
    lines.push(`Note: ${truncate(guardrail.note, 200)}`);
  }

  return lines.join("\n");
}

function appendParamDetailLines(
  lines: string[],
  toolName: string,
  params: Record<string, unknown>,
): void {
  // process and message live params don't expose command/url/path/to. See #43.
  if (toolName === "process") {
    const action = typeof params.action === "string" ? params.action : "";
    const sessionId = typeof params.sessionId === "string" ? params.sessionId : "";
    if (action) lines.push(`Action: ${truncate(action, 200)}`);
    if (sessionId) lines.push(`Session: ${truncate(sessionId, 200)}`);
    return;
  }
  if (toolName === "message") {
    const action = typeof params.action === "string" ? params.action : "";
    const target = typeof params.target === "string" ? params.target : "";
    const channel = typeof params.channel === "string" ? params.channel : "";
    const dest = target || channel;
    if (action) lines.push(`Action: ${truncate(action, 200)}`);
    if (dest) lines.push(`To: ${truncate(dest, 200)}`);
    return;
  }
  if (params.command) {
    lines.push(`Command: ${truncate(String(params.command), 200)}`);
    return;
  }
  if (params.url) {
    lines.push(`URL: ${truncate(String(params.url), 200)}`);
    return;
  }
  if (params.path || params.file_path) {
    lines.push(`Path: ${truncate(String(params.path || params.file_path), 200)}`);
    return;
  }
  if (params.to) {
    lines.push(`To: ${truncate(String(params.to), 200)}`);
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/**
 * Send an alert via a gateway method. The caller provides the send function
 * (registered via api.registerGatewayMethod) to keep this module decoupled
 * from the plugin API.
 */
export async function sendAlert(
  message: string,
  send: (msg: string) => Promise<void> | void,
): Promise<void> {
  try {
    await send(message);
  } catch {
    // Alert delivery is best-effort — don't crash the plugin
  }
}
