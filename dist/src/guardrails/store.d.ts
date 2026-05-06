import { type Guardrail, type NewGuardrail } from "./types.js";
export declare class GuardrailStore {
    private rules;
    private filePath;
    constructor(filePath: string);
    /**
     * Load guardrails from disk. Drops invalid entries (validated end-to-end
     * via isValidGuardrail) with a warning, then re-saves to clean up the
     * file. No version field, no migration logic — single coherent shape.
     */
    load(): void;
    /** Atomic save: write tmp + rename. */
    save(): void;
    /**
     * Add a rule, persist, and (on save failure) roll back. For a security-
     * boundary store, in-memory state must never diverge from disk — a phantom
     * guardrail could match live tool calls until the next gateway restart.
     * Pattern mirrors src/risk/saved-searches-store.ts.
     */
    add(guardrail: Guardrail): void;
    /** Remove by id, persist, rollback on save failure. */
    remove(id: string): boolean;
    /**
     * Patch action / note / selector.agent / selector.tools.values / target.pattern.
     * (selector.tools.mode, target.kind) remain immutable — they define rule
     * identity for idempotency, so mutating them silently is equivalent to
     * creating a different rule. Caller (the route handler) is responsible for
     * validating that toolsValues is only supplied for `mode === "names"` rules
     * and that targetPattern is a non-empty string. Rollback on save failure
     * restores every mutated field plus the cached `literalIdentity` flag.
     */
    update(id: string, patch: {
        action?: Guardrail["action"];
        note?: string;
        agent?: Guardrail["selector"]["agent"];
        toolsValues?: string[];
        targetPattern?: string;
    }): Guardrail | null;
    /**
     * Match a tool call against the rule list. Single-pass scan in operator-
     * visible insertion order (first-match-wins, no severity precedence, no
     * agent-specific precedence, no fast-path bucket). Memoizes
     * extractIdentityKey across rules — invoked at most once per match() call.
     * Spec §5.
     */
    match(agentId: string, toolName: string, params: Record<string, unknown>): Guardrail | null;
    /** Read-only mirror of match() — kept as a separate method for clarity at
     *  call sites that want to express "I'm only inspecting, not gating." */
    peek(agentId: string, toolName: string, params: Record<string, unknown>): Guardrail | null;
    /**
     * Find a rule with the same canonical (selector, target). Idempotency
     * primitive — a POST whose canonical-form rule already exists returns the
     * existing rule. action/note differences do NOT make rules distinct;
     * names-mode value arrays are compared in canonical-sorted order. Spec §7.4.
     */
    findEquivalent(input: Pick<NewGuardrail, "selector" | "target">): Guardrail | null;
    /** List rules, optionally narrowed to one agent. Global rules (selector.agent
     *  null) are always included in agent-filtered results. */
    list(filters?: {
        agentId?: string;
    }): Guardrail[];
    static generateId(): string;
}
