import type { AuditLogger } from "../audit/logger.js";
import type { PluginLogger, SessionEvent } from "../types.js";

export function createSessionStartHandler(auditLogger: AuditLogger, logger: PluginLogger) {
  return async (_event: SessionEvent, _ctx: unknown): Promise<void> => {
    // Ensure audit logger is initialized
    await auditLogger.init();

    logger.info("ClawLens: Session started");
  };
}
