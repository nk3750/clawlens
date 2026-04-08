import type { AuditLogger } from "../audit/logger";
import type { ClawLensConfig } from "../config";
import type { RateLimiter } from "../rate/limiter";
import type { SessionContext } from "../risk/session-context";
import type { PluginLogger, SessionEvent } from "../types";
export declare function createSessionEndHandler(auditLogger: AuditLogger, rateLimiter: RateLimiter, config: ClawLensConfig, logger: PluginLogger, sessionContext: SessionContext): (event: SessionEvent, _ctx: unknown) => Promise<void>;
