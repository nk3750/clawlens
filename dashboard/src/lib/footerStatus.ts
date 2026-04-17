import type { SSEStatus } from "./sseStatus";

/** Human-readable label for the SSE liveness chip in the footer. */
export function formatSSEStatusLabel(status: SSEStatus): string {
  switch (status) {
    case "live":
      return "SSE live";
    case "reconnecting":
      return "SSE reconnecting";
    case "offline":
      return "SSE offline";
  }
}

/**
 * CSS variable name for the colour the SSE chip should use. Kept as a var
 * reference (not a resolved hex) so the palette in index.css stays canonical.
 */
export function sseStatusColorVar(status: SSEStatus): string {
  switch (status) {
    case "live":
      return "var(--cl-risk-low)";
    case "reconnecting":
      return "var(--cl-risk-medium)";
    case "offline":
      return "var(--cl-risk-high)";
  }
}

/** "ClawLens v0.2.0" — or "ClawLens" when the build forgot to inject a version. */
export function formatVersionLabel(version: string | undefined | null): string {
  const trimmed = typeof version === "string" ? version.trim() : "";
  return trimmed.length > 0 ? `ClawLens v${trimmed}` : "ClawLens";
}

/**
 * Age of the last audit entry vs. now. Phase A has no backend source for this
 * so the caller passes undefined and we surface an em dash. Phase B
 * (homepage-v3-stats-strip-spec) adds stats.lastEntryTimestamp and we wire
 * the real value in here.
 */
export function formatAuditAge(lastEntryIso: string | undefined | null, nowMs: number): string {
  if (!lastEntryIso) return "audit —";
  const then = Date.parse(lastEntryIso);
  if (Number.isNaN(then)) return "audit —";
  const diff = Math.max(0, Math.floor((nowMs - then) / 1000));
  if (diff < 60) return `audit ${diff}s old`;
  if (diff < 3600) return `audit ${Math.floor(diff / 60)}m old`;
  if (diff < 86400) return `audit ${Math.floor(diff / 3600)}h old`;
  return `audit ${Math.floor(diff / 86400)}d old`;
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
