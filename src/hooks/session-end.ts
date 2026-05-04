import { generateDigest } from "../audit/digest.js";
import type { AuditLogger } from "../audit/logger.js";
import type { ClawLensConfig } from "../config.js";
import type { SessionContext } from "../risk/session-context.js";
import type { PluginLogger, SessionEvent } from "../types.js";

export function createSessionEndHandler(
  auditLogger: AuditLogger,
  config: ClawLensConfig,
  logger: PluginLogger,
  sessionContext: SessionContext,
) {
  return async (event: SessionEvent, _ctx: unknown): Promise<void> => {
    // Clean up session context
    sessionContext.cleanup(event.sessionKey);

    // Flush audit log
    await auditLogger.flush();

    // Generate digest if configured
    if (config.digest.schedule !== "off") {
      try {
        const entries = auditLogger.readEntries();
        // Filter to today's entries
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayStr = today.toISOString();
        const todayEntries = entries.filter((e) => e.timestamp >= todayStr);

        if (todayEntries.length > 0) {
          const digest = generateDigest(todayEntries);
          logger.info(`ClawLens: Session digest:\n${digest}`);
        }
      } catch (err) {
        logger.error("ClawLens: Failed to generate digest:", err);
      }
    }

    logger.info("ClawLens: Session ended");
  };
}
