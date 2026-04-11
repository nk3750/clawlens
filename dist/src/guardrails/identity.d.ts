/**
 * Identity key extraction for guardrail matching.
 *
 * Used both when creating a guardrail (from audit entry) and when checking
 * in before_tool_call (from live tool call). Same function, same output —
 * exact match guaranteed.
 */
export declare function extractIdentityKey(toolName: string, params: Record<string, unknown>): string;
export declare function normalizeCommand(cmd: string): string;
/** Composite lookup key for O(1) guardrail matching. */
export declare function lookupKey(agentId: string, tool: string, identityKey: string): string;
