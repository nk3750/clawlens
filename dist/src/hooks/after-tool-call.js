export function createAfterToolCallHandler(auditLogger) {
    return (event, ctx) => {
        const sessionKey = ctx?.sessionKey || "default";
        auditLogger.logResult({
            timestamp: new Date().toISOString(),
            toolName: event.toolName,
            toolCallId: event.toolCallId,
            executionResult: event.result ? "success" : "failure",
            agentId: ctx?.agentId,
            sessionKey: sessionKey !== "default" ? sessionKey : undefined,
        });
    };
}
//# sourceMappingURL=after-tool-call.js.map