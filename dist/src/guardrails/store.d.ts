import { type Guardrail } from "./types";
export declare class GuardrailStore {
    private byKey;
    private all;
    private filePath;
    constructor(filePath: string);
    /** Load guardrails from disk into memory. Migrates out invalid action types. */
    load(): void;
    /** Persist guardrails to disk atomically (write tmp + rename). */
    save(): void;
    /** Add a guardrail, persist, and update the index. */
    add(guardrail: Guardrail): void;
    /** Remove a guardrail by ID. */
    remove(id: string): boolean;
    /** Update fields on an existing guardrail. */
    update(id: string, patch: Partial<Pick<Guardrail, "action" | "agentId">>): Guardrail | null;
    /**
     * Match a tool call against guardrails.
     * Checks agent-specific first, then global (*).
     */
    match(agentId: string, tool: string, identityKey: string): Guardrail | null;
    /** Read-only match — checks for a matching guardrail without side effects. */
    peek(agentId: string, tool: string, identityKey: string): Guardrail | null;
    /** List guardrails, optionally filtered by agentId. */
    list(filters?: {
        agentId?: string;
    }): Guardrail[];
    /** Generate a guardrail ID. */
    static generateId(): string;
    private rebuildIndex;
    private indexOne;
}
