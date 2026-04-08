export function createSessionStartHandler(engine, _loader, auditLogger, rateLimiter, logger) {
    return async (_event, _ctx) => {
        // Ensure policy is loaded
        if (!engine.getPolicy()) {
            logger.warn("ClawLens: No policy loaded at session start — service may not have started");
        }
        // Ensure audit logger is initialized
        await auditLogger.init();
        // Ensure rate limiter state is loaded
        rateLimiter.restore();
        logger.info("ClawLens: Session started");
    };
}
//# sourceMappingURL=session-start.js.map