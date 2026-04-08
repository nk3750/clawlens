export function createAfterToolCallHandler(auditLogger, rateLimiter) {
    return (event, _ctx) => {
        auditLogger.logResult({
            timestamp: new Date().toISOString(),
            toolName: event.toolName,
            toolCallId: event.toolCallId,
            executionResult: event.result ? "success" : "failure",
        });
        rateLimiter.record(event.toolName);
    };
}
//# sourceMappingURL=after-tool-call.js.map