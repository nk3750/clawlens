import type { AuditEntry } from "./logger";
/**
 * Drop duplicate audit entries in place (preserving input order).
 *
 * Dupe key is `(toolCallId, timestamp, toolName, kind)`. This collapses
 * the 7× identical-timestamp decision bursts seen in production logs
 * while still preserving the distinct decision / after / eval entries
 * for a single tool call (they differ by kind).
 *
 * Read-time only. The on-disk log is untouched — hash chain integrity
 * is preserved for audit.
 */
export declare function dedupeAuditEntries(entries: AuditEntry[]): AuditEntry[];
