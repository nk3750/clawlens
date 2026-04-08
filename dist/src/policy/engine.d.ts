import type { Policy, PolicyDecision } from "./types";
export declare class PolicyEngine {
    private policy;
    load(policy: Policy): void;
    getPolicy(): Policy | null;
    /**
     * Evaluate a tool call against loaded policy rules (first-match-wins).
     *
     * @param getActionCount - optional callback for rate limit checks:
     *   (toolName, ruleName, windowSec) => count of actions in window
     */
    evaluate(toolName: string, params: Record<string, unknown>, getActionCount?: (toolName: string, ruleName: string, windowSec: number) => number): PolicyDecision;
    /** Get list of tool descriptions that are blocked by policy. */
    getBlockedTools(): string[];
    /** Get list of tool descriptions that require approval. */
    getApprovalRequiredTools(): string[];
}
