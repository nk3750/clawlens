export function createBeforePromptBuildHandler(engine) {
    return (_event, _ctx) => {
        const blocked = engine.getBlockedTools();
        const approvalRequired = engine.getApprovalRequiredTools();
        if (blocked.length === 0 && approvalRequired.length === 0)
            return;
        const lines = ["[ClawLens] Policy constraints active:"];
        if (blocked.length > 0) {
            lines.push(`Blocked tools: ${blocked.join(", ")}`);
        }
        if (approvalRequired.length > 0) {
            lines.push(`Approval required for: ${approvalRequired.join(", ")}`);
        }
        lines.push("Do not plan actions using blocked tools — they will be denied.");
        return { appendSystemContext: lines.join("\n") };
    };
}
//# sourceMappingURL=before-prompt-build.js.map