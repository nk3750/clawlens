export function createAfterToolCallHandler(auditLogger) {
    return (event, _ctx) => {
        auditLogger.logResult({
            timestamp: new Date().toISOString(),
            toolName: event.toolName,
            toolCallId: event.toolCallId,
            executionResult: event.result ? "success" : "failure",
        });
    };
}
//# sourceMappingURL=after-tool-call.js.map