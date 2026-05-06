import type { AuditEntry } from "./logger.js";
/**
 * Generate a narrative daily digest from audit log entries.
 * Now includes per-agent risk summaries and high-risk call highlights.
 */
export declare function generateDigest(entries: AuditEntry[], date?: Date): string;
