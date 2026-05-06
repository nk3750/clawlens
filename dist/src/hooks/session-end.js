import { generateDigest } from "../audit/digest.js";
export function createSessionEndHandler(auditLogger, config, logger, sessionContext) {
    return async (event, _ctx) => {
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
            }
            catch (err) {
                logger.error("ClawLens: Failed to generate digest:", err);
            }
        }
        logger.info("ClawLens: Session ended");
    };
}
//# sourceMappingURL=session-end.js.map