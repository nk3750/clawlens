export type GuardrailAction = { type: "block" } | { type: "require_approval" };

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

const VALID_ACTION_TYPES = new Set(["block", "require_approval"]);

export function isValidGuardrailAction(action: unknown): action is GuardrailAction {
  if (!action || typeof action !== "object") return false;
  const a = action as Record<string, unknown>;
  return typeof a.type === "string" && VALID_ACTION_TYPES.has(a.type);
}
