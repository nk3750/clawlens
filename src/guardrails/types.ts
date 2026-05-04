import { type ActivityCategory, ALL_CATEGORIES } from "../dashboard/categories.js";

// ── Selector ────────────────────────────────────────────────

export type AgentSelector = string | null; // null = all agents

export type ToolSelector =
  | { mode: "names"; values: string[] }
  | { mode: "category"; value: ActivityCategory }
  | { mode: "any" };

export interface Selector {
  agent: AgentSelector;
  tools: ToolSelector;
}

// ── Target ──────────────────────────────────────────────────

export type Target =
  | { kind: "path-glob"; pattern: string }
  | { kind: "url-glob"; pattern: string }
  | { kind: "command-glob"; pattern: string }
  | { kind: "identity-glob"; pattern: string };

// ── Action ──────────────────────────────────────────────────
// Flat string union — NOT { type: "block" } object.

export type Action = "block" | "require_approval" | "allow_notify";

// ── Guardrail rule ──────────────────────────────────────────

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

// ── Validators ──────────────────────────────────────────────
// Exhaustive shape checks. Every union variant gets a switch case so that
// adding a new variant (e.g. a fourth target kind) forces a corresponding
// validator branch — the type system rejects the omission at compile time.

const VALID_ACTIONS = new Set<string>(["block", "require_approval", "allow_notify"]);
const VALID_TARGET_KINDS = new Set<string>([
  "path-glob",
  "url-glob",
  "command-glob",
  "identity-glob",
]);
const VALID_CATEGORIES = new Set<string>(ALL_CATEGORIES);

export function isValidAction(value: unknown): value is Action {
  return typeof value === "string" && VALID_ACTIONS.has(value);
}

export function isValidSelector(value: unknown): value is Selector {
  if (!value || typeof value !== "object") return false;
  const s = value as Record<string, unknown>;
  if (s.agent !== null && typeof s.agent !== "string") return false;
  const tools = s.tools as Record<string, unknown> | undefined | null;
  if (!tools || typeof tools !== "object") return false;
  switch (tools.mode) {
    case "any":
      return true;
    case "names": {
      const values = tools.values;
      if (!Array.isArray(values) || values.length === 0) return false;
      return values.every((v) => typeof v === "string" && v.length > 0);
    }
    case "category":
      return typeof tools.value === "string" && VALID_CATEGORIES.has(tools.value);
    default:
      return false;
  }
}

export function isValidTarget(value: unknown): value is Target {
  if (!value || typeof value !== "object") return false;
  const t = value as Record<string, unknown>;
  if (typeof t.kind !== "string" || !VALID_TARGET_KINDS.has(t.kind)) return false;
  return typeof t.pattern === "string" && t.pattern.length > 0;
}

function isValidSource(value: unknown): value is GuardrailSource {
  if (!value || typeof value !== "object") return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.toolCallId === "string" &&
    typeof s.sessionKey === "string" &&
    typeof s.agentId === "string"
  );
}

export function isValidGuardrail(value: unknown): value is Guardrail {
  if (!value || typeof value !== "object") return false;
  const g = value as Record<string, unknown>;
  if (typeof g.id !== "string" || g.id.length === 0) return false;
  if (!isValidSelector(g.selector)) return false;
  if (!isValidTarget(g.target)) return false;
  if (!isValidAction(g.action)) return false;
  if (typeof g.description !== "string") return false;
  if (typeof g.createdAt !== "string") return false;
  if (!isValidSource(g.source)) return false;
  if (typeof g.riskScore !== "number") return false;
  if (g.note !== undefined && typeof g.note !== "string") return false;
  return true;
}
