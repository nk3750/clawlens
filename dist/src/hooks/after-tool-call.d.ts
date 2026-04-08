import type { AuditLogger } from "../audit/logger";
import type { RateLimiter } from "../rate/limiter";
import type { AfterToolCallEvent } from "../types";
export declare function createAfterToolCallHandler(auditLogger: AuditLogger, rateLimiter: RateLimiter): (event: AfterToolCallEvent, _ctx: unknown) => void;
