import type { AuditLogger } from "../audit/logger";
import type { AfterToolCallEvent } from "../types";
export declare function createAfterToolCallHandler(auditLogger: AuditLogger): (event: AfterToolCallEvent, _ctx: unknown) => void;
