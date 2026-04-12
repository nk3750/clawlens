const VALID_ACTION_TYPES = new Set(["block", "require_approval"]);
export function isValidGuardrailAction(action) {
    if (!action || typeof action !== "object")
        return false;
    const a = action;
    return typeof a.type === "string" && VALID_ACTION_TYPES.has(a.type);
}
//# sourceMappingURL=types.js.map