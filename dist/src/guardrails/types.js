import { ALL_CATEGORIES } from "../dashboard/categories";
// ── Validators ──────────────────────────────────────────────
// Exhaustive shape checks. Every union variant gets a switch case so that
// adding a new variant (e.g. a fourth target kind) forces a corresponding
// validator branch — the type system rejects the omission at compile time.
const VALID_ACTIONS = new Set(["block", "require_approval", "allow_notify"]);
const VALID_TARGET_KINDS = new Set([
    "path-glob",
    "url-glob",
    "command-glob",
    "identity-glob",
]);
const VALID_CATEGORIES = new Set(ALL_CATEGORIES);
export function isValidAction(value) {
    return typeof value === "string" && VALID_ACTIONS.has(value);
}
export function isValidSelector(value) {
    if (!value || typeof value !== "object")
        return false;
    const s = value;
    if (s.agent !== null && typeof s.agent !== "string")
        return false;
    const tools = s.tools;
    if (!tools || typeof tools !== "object")
        return false;
    switch (tools.mode) {
        case "any":
            return true;
        case "names": {
            const values = tools.values;
            if (!Array.isArray(values) || values.length === 0)
                return false;
            return values.every((v) => typeof v === "string" && v.length > 0);
        }
        case "category":
            return typeof tools.value === "string" && VALID_CATEGORIES.has(tools.value);
        default:
            return false;
    }
}
export function isValidTarget(value) {
    if (!value || typeof value !== "object")
        return false;
    const t = value;
    if (typeof t.kind !== "string" || !VALID_TARGET_KINDS.has(t.kind))
        return false;
    return typeof t.pattern === "string" && t.pattern.length > 0;
}
function isValidSource(value) {
    if (!value || typeof value !== "object")
        return false;
    const s = value;
    return (typeof s.toolCallId === "string" &&
        typeof s.sessionKey === "string" &&
        typeof s.agentId === "string");
}
export function isValidGuardrail(value) {
    if (!value || typeof value !== "object")
        return false;
    const g = value;
    if (typeof g.id !== "string" || g.id.length === 0)
        return false;
    if (!isValidSelector(g.selector))
        return false;
    if (!isValidTarget(g.target))
        return false;
    if (!isValidAction(g.action))
        return false;
    if (typeof g.description !== "string")
        return false;
    if (typeof g.createdAt !== "string")
        return false;
    if (!isValidSource(g.source))
        return false;
    if (typeof g.riskScore !== "number")
        return false;
    if (g.note !== undefined && typeof g.note !== "string")
        return false;
    return true;
}
//# sourceMappingURL=types.js.map