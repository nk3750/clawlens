import type { AuditLogger } from "../audit/logger";
import type { PluginLogger, SessionEvent } from "../types";
export declare function createSessionStartHandler(auditLogger: AuditLogger, logger: PluginLogger): (_event: SessionEvent, _ctx: unknown) => Promise<void>;
