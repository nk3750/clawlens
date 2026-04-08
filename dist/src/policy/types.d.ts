export type PolicyAction = "allow" | "block" | "approval_required";
export type Severity = "info" | "warning" | "critical";
export type TimeoutAction = "allow" | "deny";
export interface RateLimit {
    max: number;
    window: number;
    on_exceed: PolicyAction;
    on_exceed_reason?: string;
}
export interface RuleMatch {
    tool?: string | string[];
    params?: Record<string, string>;
}
export interface PolicyRule {
    name: string;
    match: RuleMatch;
    action: PolicyAction;
    reason?: string;
    severity?: Severity;
    timeout?: number;
    timeout_action?: TimeoutAction;
    rate_limit?: RateLimit;
}
export interface PolicyDefaults {
    unknown_actions: PolicyAction;
    approval_timeout: number;
    timeout_action: TimeoutAction;
    digest: string;
}
export interface Policy {
    version: string;
    defaults: PolicyDefaults;
    rules: PolicyRule[];
}
export interface PolicyDecision {
    action: PolicyAction;
    ruleName?: string;
    reason?: string;
    severity?: Severity;
    timeout?: number;
    timeoutAction?: TimeoutAction;
}
