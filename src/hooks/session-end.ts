import type { AuditLogger } from "../audit/logger";
import type { RateLimiter } from "../rate/limiter";
import type { ClawClipConfig } from "../config";
import type { PluginLogger, SessionEvent } from "../types";
import { generateDigest } from "../audit/digest";

export function createSessionEndHandler(
  auditLogger: AuditLogger,
  rateLimiter: RateLimiter,
  config: ClawClipConfig,
  logger: PluginLogger,
) {
  return async (_event: SessionEvent, _ctx: unknown): Promise<void> => {
    // Flush audit log
    await auditLogger.flush();

    // Persist rate limiter state
    rateLimiter.persist();

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
          logger.info("ClawClip: Session digest:\n" + digest);
        }
      } catch (err) {
        logger.error("ClawClip: Failed to generate digest:", err);
      }
    }

    logger.info("ClawClip: Session ended");
  };
}
