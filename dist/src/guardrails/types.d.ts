export type GuardrailAction = {
    type: "block";
} | {
    type: "require_approval";
};
export interface Guardrail {
    id: string;
    tool: string;
    identityKey: string;
    matchMode: "exact";
    action: GuardrailAction;
    agentId: string | null;
    createdAt: string;
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
