import type { AuditEntry } from "./logger.js";

/**
 * Classify an entry for dedupe purposes. Separate kinds keep a decision
 * entry from being collapsed with its later executionResult entry, etc.
 */
function entryKind(e: AuditEntry): "dec" | "res" | "eval" | "other" {
  if (e.decision) return "dec";
  if (e.executionResult) return "res";
  if (e.llmEvaluation) return "eval";
  return "other";
}

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
export function dedupeAuditEntries(entries: AuditEntry[]): AuditEntry[] {
  const seen = new Set<string>();
  const out: AuditEntry[] = [];
  for (const e of entries) {
    const key = `${e.toolCallId ?? ""}:${e.timestamp}:${e.toolName}:${entryKind(e)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}
