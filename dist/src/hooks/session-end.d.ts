import type { AuditLogger } from "../audit/logger.js";
import type { ClawLensConfig } from "../config.js";
import type { SessionContext } from "../risk/session-context.js";
import type { PluginLogger, SessionEvent } from "../types.js";
export declare function createSessionEndHandler(auditLogger: AuditLogger, config: ClawLensConfig, logger: PluginLogger, sessionContext: SessionContext): (event: SessionEvent, _ctx: unknown) => Promise<void>;
