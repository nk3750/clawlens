/**
 * Generate a narrative daily digest from audit log entries.
 * Now includes per-agent risk summaries and high-risk call highlights.
 */
export function generateDigest(entries, date) {
    const now = date || new Date();
    const dateStr = now.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
    });
    const lines = [];
    lines.push(`ClawLens Daily Summary (${dateStr})`);
    lines.push("");
    // Separate decision entries from result/resolution/evaluation entries
    const decisions = entries.filter((e) => !e.executionResult && !e.userResponse && !e.refToolCallId);
    const resolutions = entries.filter((e) => e.userResponse);
    const approved = resolutions.filter((e) => e.userResponse === "approved");
    const denied = resolutions.filter((e) => e.userResponse === "denied");
    const timedOut = resolutions.filter((e) => e.userResponse === "timeout");
    const allowed = decisions.filter((e) => e.decision === "allow");
    const blocked = decisions.filter((e) => e.decision === "block");
    const total = decisions.length;
    if (total === 0) {
        lines.push("No tool calls recorded today.");
        return lines.join("\n");
    }
    // Risk summary across all decisions
    const scoredDecisions = decisions.filter((e) => typeof e.riskScore === "number");
    const hasRiskData = scoredDecisions.length > 0;
    lines.push(`Your agent made ${total} tool call${total !== 1 ? "s" : ""} today.`);
    const parts = [];
    if (allowed.length > 0)
        parts.push(`${allowed.length} auto-allowed (reads, searches)`);
    if (approved.length > 0)
        parts.push(`${approved.length} approved by you`);
    if (blocked.length > 0)
        parts.push(`${blocked.length} blocked by policy`);
    if (timedOut.length > 0)
        parts.push(`${timedOut.length} timed out (denied)`);
    if (denied.length > 0)
        parts.push(`${denied.length} denied by you`);
    for (const part of parts) {
        lines.push(`- ${part}`);
    }
    // Per-agent risk breakdown (if risk data exists)
    if (hasRiskData) {
        lines.push("");
        // LLM evaluation entries — index by refToolCallId for lookup
        const evalEntries = entries.filter((e) => e.refToolCallId && e.llmEvaluation);
        const evalByRef = new Map(evalEntries.map((e) => [e.refToolCallId, e]));
        // Group decisions by agent (toolCallId prefix or "main")
        // For now we treat all as one agent since ctx.agentId isn't in audit entries yet
        const scores = scoredDecisions.map((e) => e.riskScore);
        const avgRisk = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
        const peakRisk = Math.max(...scores);
        const highRiskCalls = scoredDecisions.filter((e) => e.riskTier === "high" || e.riskTier === "critical");
        lines.push(`Risk: ${total} tool calls, avg risk ${avgRisk}, peak ${peakRisk}`);
        if (highRiskCalls.length > 0) {
            lines.push(`  \u2014 \u26a0\ufe0f ${highRiskCalls.length} high-risk call${highRiskCalls.length !== 1 ? "s" : ""}`);
            for (const entry of highRiskCalls.slice(0, 5)) {
                const detail = entry.params?.command
                    ? `${entry.toolName}(${truncate(String(entry.params.command), 60)})`
                    : entry.params?.url
                        ? `${entry.toolName}(${truncate(String(entry.params.url), 60)})`
                        : entry.toolName;
                // Check for LLM evaluation
                const evalEntry = entry.toolCallId ? evalByRef.get(entry.toolCallId) : undefined;
                const reasoning = evalEntry?.llmEvaluation?.reasoning;
                if (reasoning) {
                    lines.push(`  \u2014 ${detail} scored ${entry.riskScore}: "${reasoning}"`);
                }
                else {
                    const tagStr = entry.riskTags?.length ? ` [${entry.riskTags.join(", ")}]` : "";
                    lines.push(`  \u2014 ${detail} scored ${entry.riskScore}${tagStr}`);
                }
            }
        }
    }
    // Highlight blocked actions (up to 5)
    if (blocked.length > 0) {
        lines.push("");
        for (const entry of blocked.slice(0, 5)) {
            const time = new Date(entry.timestamp).toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
            });
            const detail = entry.params?.command
                ? `\`${entry.params.command}\``
                : `\`${entry.toolName}\``;
            const rule = entry.policyRule || "policy";
            lines.push(`Blocked: Agent tried to run ${detail} at ${time} \u2014 blocked by "${rule}" rule.`);
        }
    }
    // Highlight approved actions (up to 5)
    if (approved.length > 0) {
        lines.push("");
        for (const entry of approved.slice(0, 5)) {
            const time = new Date(entry.timestamp).toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
            });
            lines.push(`Approved: You approved \`${entry.toolName}\` at ${time}.`);
        }
    }
    lines.push("");
    if (hasRiskData) {
        const highCount = scoredDecisions.filter((e) => e.riskTier === "high" || e.riskTier === "critical").length;
        if (highCount === 0) {
            lines.push("No anomalies detected. All actions were low/medium risk.");
        }
        else {
            lines.push(`${highCount} high-risk action${highCount !== 1 ? "s" : ""} detected \u2014 review recommended.`);
        }
    }
    else {
        lines.push("No anomalies detected.");
    }
    return lines.join("\n");
}
function truncate(s, max) {
    return s.length > max ? `${s.slice(0, max)}\u2026` : s;
}
//# sourceMappingURL=digest.js.map