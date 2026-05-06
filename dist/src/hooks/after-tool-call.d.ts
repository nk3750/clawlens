import type { AuditLogger } from "../audit/logger.js";
import type { AfterToolCallEvent } from "../types.js";
export declare function createAfterToolCallHandler(auditLogger: AuditLogger): (event: AfterToolCallEvent, ctx: Record<string, unknown>) => void;
