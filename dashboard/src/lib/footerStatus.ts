/** "ClawLens v0.2.0" — or "ClawLens" when the build forgot to inject a version. */
export function formatVersionLabel(version: string | undefined | null): string {
  const trimmed = typeof version === "string" ? version.trim() : "";
  return trimmed.length > 0 ? `ClawLens v${trimmed}` : "ClawLens";
}

/**
 * Gateway uptime display. Phase A has no backend source; "—" placeholder.
 * Shaped to accept ms so Phase B can pass a real value without changing the
 * formatter API.
 */
export function formatGatewayUptime(uptimeMs: number | undefined | null): string {
  if (uptimeMs == null || !Number.isFinite(uptimeMs) || uptimeMs < 0) {
    return "gateway —";
  }
  const s = Math.floor(uptimeMs / 1000);
  if (s < 60) return `gateway ${s}s uptime`;
  if (s < 3600) return `gateway ${Math.floor(s / 60)}m uptime`;
  if (s < 86400) return `gateway ${Math.floor(s / 3600)}h uptime`;
  return `gateway ${Math.floor(s / 86400)}d uptime`;
}
