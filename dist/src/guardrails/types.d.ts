import { type ActivityCategory } from "../dashboard/categories.js";
export type AgentSelector = string | null;
export type ToolSelector = {
    mode: "names";
    values: string[];
} | {
    mode: "category";
    value: ActivityCategory;
} | {
    mode: "any";
};
export interface Selector {
    agent: AgentSelector;
    tools: ToolSelector;
}
export type Target = {
    kind: "path-glob";
    pattern: string;
} | {
    kind: "url-glob";
    pattern: string;
} | {
    kind: "command-glob";
    pattern: string;
} | {
    kind: "identity-glob";
    pattern: string;
};
export type Action = "block" | "require_approval" | "allow_notify";
export interface GuardrailSource {
    toolCallId: string;
    sessionKey: string;
    agentId: string;
}
export interface Guardrail {
    id: string;
    selector: Selector;
    target: Target;
    action: Action;
    note?: string;
    description: string;
    createdAt: string;
    source: GuardrailSource;
    riskScore: number;
}
/** Shape posted to /api/guardrails — id, createdAt, description are server-derived. */
export interface NewGuardrail {
    selector: Selector;
    target: Target;
    action: Action;
    note?: string;
    description?: string;
    source: GuardrailSource;
    riskScore: number;
}
export interface GuardrailFile {
    guardrails: Guardrail[];
}
export declare function isValidAction(value: unknown): value is Action;
export declare function isValidSelector(value: unknown): value is Selector;
export declare function isValidTarget(value: unknown): value is Target;
export declare function isValidGuardrail(value: unknown): value is Guardrail;
