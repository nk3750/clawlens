import type { AuditEntry } from "./logger.js";
export declare function exportToJSON(entries: AuditEntry[], since?: string): string;
export declare function exportToCSV(entries: AuditEntry[], since?: string): string;
