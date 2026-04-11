export type GuardrailAction = {
    type: "block";
} | {
    type: "require_approval";
} | {
    type: "allow_once";
} | {
    type: "allow_hours";
    hours: number;
};
export interface Guardrail {
    id: string;
    tool: string;
    identityKey: string;
    matchMode: "exact";
    action: GuardrailAction;
    agentId: string | null;
    createdAt: string;
    expiresAt: string | null;
    source: {
        toolCallId: string;
        sessionKey: string;
        agentId: string;
    };
    description: string;
    riskScore: number;
}
export interface GuardrailFile {
    version: 1;
    guardrails: Guardrail[];
}
export declare function isValidGuardrailAction(action: unknown): action is GuardrailAction;
