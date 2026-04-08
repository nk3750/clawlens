import type { AuditLogger } from "../audit/logger";
import type { PolicyEngine } from "../policy/engine";
import type { PolicyLoader } from "../policy/loader";
import type { RateLimiter } from "../rate/limiter";
import type { PluginLogger, SessionEvent } from "../types";
export declare function createSessionStartHandler(engine: PolicyEngine, _loader: PolicyLoader, auditLogger: AuditLogger, rateLimiter: RateLimiter, logger: PluginLogger): (_event: SessionEvent, _ctx: unknown) => Promise<void>;
