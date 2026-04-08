import type { AuditEntry } from "./logger";
export declare function exportToJSON(entries: AuditEntry[], since?: string): string;
export declare function exportToCSV(entries: AuditEntry[], since?: string): string;
