import type { AuditLogger } from "../audit/logger.js";
import type { PluginLogger, SessionEvent } from "../types.js";
export declare function createSessionStartHandler(auditLogger: AuditLogger, logger: PluginLogger): (_event: SessionEvent, _ctx: unknown) => Promise<void>;
