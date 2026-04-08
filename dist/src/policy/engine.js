import { matchRule } from "./matcher";
export class PolicyEngine {
    policy = null;
    load(policy) {
        this.policy = policy;
    }
    getPolicy() {
        return this.policy;
    }
    /**
     * Evaluate a tool call against loaded policy rules (first-match-wins).
     *
     * @param getActionCount - optional callback for rate limit checks:
     *   (toolName, ruleName, windowSec) => count of actions in window
     */
    evaluate(toolName, params, getActionCount) {
        if (!this.policy) {
            // Fail closed: no policy loaded = block
            return { action: "block", reason: "No policy loaded — fail closed" };
        }
        for (const rule of this.policy.rules) {
            if (matchRule(toolName, params, rule.match)) {
                // Check rate limit before returning the rule's action
                if (rule.rate_limit && getActionCount) {
                    const count = getActionCount(toolName, rule.name, rule.rate_limit.window);
                    if (count >= rule.rate_limit.max) {
                        return {
                            action: rule.rate_limit.on_exceed,
                            ruleName: rule.name,
                            reason: rule.rate_limit.on_exceed_reason ||
                                `Rate limit exceeded: ${rule.rate_limit.max} per ${rule.rate_limit.window}s`,
                            severity: rule.severity,
                        };
                    }
                }
                return {
                    action: rule.action,
                    ruleName: rule.name,
                    reason: rule.reason,
                    severity: rule.severity,
                    timeout: rule.timeout,
                    timeoutAction: rule.timeout_action,
                };
            }
        }
        // No rule matched — use defaults
        return {
            action: this.policy.defaults.unknown_actions,
            reason: "No matching rule — default policy applied",
        };
    }
    /** Get list of tool descriptions that are blocked by policy. */
    getBlockedTools() {
        if (!this.policy)
            return [];
        return this.policy.rules
            .filter((r) => r.action === "block" && r.match.tool)
            .map((r) => {
            const tool = r.match.tool;
            const toolStr = Array.isArray(tool) ? tool.join(", ") : tool;
            const paramInfo = r.match.params
                ? ` (${Object.entries(r.match.params)
                    .map(([k, v]) => `${k}=${v}`)
                    .join(", ")})`
                : "";
            return toolStr + paramInfo;
        });
    }
    /** Get list of tool descriptions that require approval. */
    getApprovalRequiredTools() {
        if (!this.policy)
            return [];
        return this.policy.rules
            .filter((r) => r.action === "approval_required" && r.match.tool)
            .map((r) => {
            const tool = r.match.tool;
            return Array.isArray(tool) ? tool.join(", ") : tool;
        });
    }
}
//# sourceMappingURL=engine.js.map