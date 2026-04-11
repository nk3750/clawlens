export type GuardrailAction =
  | { type: "block" }
  | { type: "require_approval" }
  | { type: "allow_once" }
  | { type: "allow_hours"; hours: number };

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

const VALID_ACTION_TYPES = new Set(["block", "require_approval", "allow_once", "allow_hours"]);

export function isValidGuardrailAction(action: unknown): action is GuardrailAction {
  if (!action || typeof action !== "object") return false;
  const a = action as Record<string, unknown>;
  if (typeof a.type !== "string" || !VALID_ACTION_TYPES.has(a.type)) return false;
  if (a.type === "allow_hours") {
    return typeof a.hours === "number" && a.hours > 0;
  }
  return true;
}
