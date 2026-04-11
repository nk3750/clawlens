export function createSessionStartHandler(auditLogger, logger) {
    return async (_event, _ctx) => {
        // Ensure audit logger is initialized
        await auditLogger.init();
        logger.info("ClawLens: Session started");
    };
}
//# sourceMappingURL=session-start.js.map