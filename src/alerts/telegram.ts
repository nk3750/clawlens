import type { AlertConfig, RiskScore } from "../risk/types";

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
        // Spans midnight
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

/**
 * Format an alert message for Telegram delivery.
 */
export function formatAlert(
  toolName: string,
  params: Record<string, unknown>,
  riskScore: RiskScore,
  dashboardUrl: string,
): string {
  const lines: string[] = [];
  lines.push("\u26a0\ufe0f ClawLens Risk Alert");
  lines.push("");

  lines.push(`Tool: ${toolName}`);

  // process and message live params don't expose command/url/path/to, so the
  // pre-existing chain skipped them entirely. Handle them explicitly first.
  // See issue #43.
  if (toolName === "process") {
    const action = typeof params.action === "string" ? params.action : "";
    const sessionId = typeof params.sessionId === "string" ? params.sessionId : "";
    if (action) lines.push(`Action: ${truncate(action, 200)}`);
    if (sessionId) lines.push(`Session: ${truncate(sessionId, 200)}`);
  } else if (toolName === "message") {
    const action = typeof params.action === "string" ? params.action : "";
    const target = typeof params.target === "string" ? params.target : "";
    const channel = typeof params.channel === "string" ? params.channel : "";
    const dest = target || channel;
    if (action) lines.push(`Action: ${truncate(action, 200)}`);
    if (dest) lines.push(`To: ${truncate(dest, 200)}`);
  } else if (params.command) {
    // Show the most relevant parameter
    lines.push(`Command: ${truncate(String(params.command), 200)}`);
  } else if (params.url) {
    lines.push(`URL: ${truncate(String(params.url), 200)}`);
  } else if (params.path || params.file_path) {
    lines.push(`Path: ${truncate(String(params.path || params.file_path), 200)}`);
  } else if (params.to) {
    lines.push(`To: ${truncate(String(params.to), 200)}`);
  }

  lines.push(`Risk Score: ${riskScore.score} (${riskScore.tier})`);

  if (riskScore.tags.length > 0) {
    lines.push(`Tags: ${riskScore.tags.join(", ")}`);
  }

  if (dashboardUrl) {
    lines.push("");
    lines.push(`View details: ${dashboardUrl}`);
  }

  return lines.join("\n");
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\u2026` : s;
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
