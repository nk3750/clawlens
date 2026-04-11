const VALID_ACTION_TYPES = new Set(["block", "require_approval", "allow_once", "allow_hours"]);
export function isValidGuardrailAction(action) {
    if (!action || typeof action !== "object")
        return false;
    const a = action;
    if (typeof a.type !== "string" || !VALID_ACTION_TYPES.has(a.type))
        return false;
    if (a.type === "allow_hours") {
        return typeof a.hours === "number" && a.hours > 0;
    }
    return true;
}
//# sourceMappingURL=types.js.map