import { AuditLogger } from "../audit/logger";
import type { AuditEntry } from "../audit/logger";

export interface StatsResponse {
  total: number;
  allowed: number;
  approved: number;
  blocked: number;
  timedOut: number;
  pending: number;
}

export interface EntryResponse {
  timestamp: string;
  toolName: string;
  toolCallId?: string;
  params: Record<string, unknown>;
  policyRule?: string;
  decision?: string;
  effectiveDecision: string;
  severity?: string;
  userResponse?: string;
  executionResult?: string;
  durationMs?: number;
}

export interface HealthResponse {
  valid: boolean;
  brokenAt?: number;
  totalEntries: number;
}

/** Filter entries to today (since midnight UTC). */
function getTodayEntries(entries: AuditEntry[]): AuditEntry[] {
  const now = new Date();
  const cutoff = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString();
  return entries.filter((e) => e.timestamp >= cutoff);
}

/** Compute the effective user-facing decision for an entry. */
export function getEffectiveDecision(entry: AuditEntry): string {
  if (entry.userResponse === "approved") return "approved";
  if (entry.userResponse === "denied") return "denied";
  if (entry.userResponse === "timeout") return "timeout";
  if (entry.decision === "allow") return "allow";
  if (entry.decision === "block") return "block";
  if (entry.decision === "approval_required") return "pending";
  if (entry.executionResult) return entry.executionResult;
  return "unknown";
}

/** True if the entry represents a policy decision (not a result log). */
function isDecisionEntry(entry: AuditEntry): boolean {
  return entry.decision !== undefined;
}

/** Compute today's decision counts. */
export function computeStats(entries: AuditEntry[]): StatsResponse {
  const todayDecisions = getTodayEntries(entries).filter(isDecisionEntry);

  let allowed = 0;
  let approved = 0;
  let blocked = 0;
  let timedOut = 0;
  let pending = 0;

  for (const entry of todayDecisions) {
    const eff = getEffectiveDecision(entry);
    switch (eff) {
      case "allow":
        allowed++;
        break;
      case "approved":
        approved++;
        break;
      case "block":
      case "denied":
        blocked++;
        break;
      case "timeout":
        timedOut++;
        break;
      case "pending":
        pending++;
        break;
    }
  }

  return {
    total: allowed + approved + blocked + timedOut,
    allowed,
    approved,
    blocked,
    timedOut,
    pending,
  };
}

/** Return paginated decision entries in reverse chronological order. */
export function getRecentEntries(
  entries: AuditEntry[],
  limit: number,
  offset: number,
): EntryResponse[] {
  const decisions = entries.filter(isDecisionEntry).reverse();

  return decisions.slice(offset, offset + limit).map((entry) => ({
    timestamp: entry.timestamp,
    toolName: entry.toolName,
    toolCallId: entry.toolCallId,
    params: entry.params,
    policyRule: entry.policyRule,
    decision: entry.decision,
    effectiveDecision: getEffectiveDecision(entry),
    severity: entry.severity,
    userResponse: entry.userResponse,
    executionResult: entry.executionResult,
    durationMs: entry.durationMs,
  }));
}

/** Verify the hash chain integrity of all entries. */
export function checkHealth(entries: AuditEntry[]): HealthResponse {
  const result = AuditLogger.verifyChain(entries);
  return {
    valid: result.valid,
    brokenAt: result.brokenAt,
    totalEntries: entries.length,
  };
}
