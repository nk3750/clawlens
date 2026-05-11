import { EventEmitter } from "node:events";
export interface AuditEntry {
    timestamp: string;
    toolName: string;
    toolCallId?: string;
    params: Record<string, unknown>;
    policyRule?: string;
    decision?: "allow" | "block" | "approval_required";
    severity?: string;
    userResponse?: "approved" | "denied" | "timeout";
    executionResult?: "success" | "failure";
    durationMs?: number;
    riskScore?: number;
    riskTier?: "low" | "medium" | "high" | "critical";
    riskTags?: string[];
    llmEvaluation?: {
        adjustedScore: number;
        reasoning: string;
        tags: string[];
        confidence: string;
        patterns: string[];
    };
    /** When present, this entry is an async evaluation appended for a prior tool call. */
    refToolCallId?: string;
    agentId?: string;
    sessionKey?: string;
    prevHash: string;
    hash: string;
}
export type AuditDecisionData = {
    timestamp: string;
    toolName: string;
    toolCallId?: string;
    params: Record<string, unknown>;
    policyRule?: string;
    decision: "allow" | "block" | "approval_required";
    severity?: string;
    riskScore?: number;
    riskTier?: "low" | "medium" | "high" | "critical";
    riskTags?: string[];
    agentId?: string;
    sessionKey?: string;
};
/**
 * Return a process-singleton AuditLogger for the given file path.
 *
 * A globalThis-keyed cache (not a module-scoped Map) is required because
 * OpenClaw's sandboxed-agent path may fall back to the embedded runner, which
 * re-imports the plugin module fresh. Each module load gets its own module
 * scope, so a module-local Map gives one cache per load — back to the original
 * race. Symbol.for + globalThis is true process-singleton.
 */
export declare function getAuditLogger(filePath: string): AuditLogger;
export declare class AuditLogger extends EventEmitter {
    private filePath;
    private lastHash;
    private writeStream;
    /** Map of `toolCallId:kind` → last write epoch-ms. Used to flag suspected double-writes. */
    private recentWrites;
    private _initialized;
    constructor(filePath: string);
    init(): Promise<void>;
    private computeHash;
    /** Ensure write stream is open. Called lazily on first write. */
    private ensureStream;
    /**
     * Warn if the same (toolCallId, kind) was just appended within 100ms.
     * Helps diagnose duplicate hook firings or redundant writer callers —
     * production logs show 7× identical-timestamp decision bursts that
     * dedupe masks at read time; this instrumentation finds the source.
     */
    private maybeWarnDoubleWrite;
    private append;
    /** Log a policy decision (from before_tool_call). */
    logDecision(data: AuditDecisionData): void;
    /** Log an approval resolution callback. */
    logApprovalResolution(data: {
        toolCallId?: string;
        toolName: string;
        approved: boolean;
        resolvedBy?: string;
        note?: string;
        agentId?: string;
    }): void;
    /** Log a tool call result (from after_tool_call). */
    logResult(data: {
        timestamp: string;
        toolName: string;
        toolCallId?: string;
        executionResult: "success" | "failure";
        durationMs?: number;
        agentId?: string;
        sessionKey?: string;
    }): void;
    /**
     * Append an LLM evaluation entry that references the original tool call.
     * This preserves the hash chain (no in-place mutation) by adding a new
     * entry with refToolCallId pointing to the original.
     */
    appendEvaluation(data: {
        refToolCallId: string;
        toolName: string;
        llmEvaluation: NonNullable<AuditEntry["llmEvaluation"]>;
        riskScore: number;
        riskTier: NonNullable<AuditEntry["riskTier"]>;
        riskTags: string[];
        agentId?: string;
        sessionKey?: string;
    }): void;
    /** Log a guardrail match event. */
    logGuardrailMatch(data: {
        timestamp: string;
        toolCallId?: string;
        toolName: string;
        guardrailId: string;
        /** Flat string union — "block" | "require_approval" | "allow_notify". */
        action: "block" | "require_approval" | "allow_notify";
        identityKey: string;
        /** Pre-formatted target rendering for the dashboard (e.g. "Path: /etc/**").
         *  Optional to keep older audit rows readable, but always supplied in
         *  production after the schema rewrite. */
        targetSummary?: string;
        agentId: string;
        sessionKey?: string;
        /** Risk fields let the dashboard bucket guardrail-gated rows into the
         *  per-agent risk-mix bar instead of leaving an empty segment for
         *  "decided but unscored" entries. */
        riskScore?: number;
        riskTier?: "low" | "medium" | "high" | "critical";
        riskTags?: string[];
    }): void;
    /** Log a guardrail approval resolution. */
    logGuardrailResolution(data: {
        guardrailId: string;
        toolCallId?: string;
        toolName: string;
        approved: boolean;
        decision: string;
        storeAction?: "removed" | "unchanged";
        agentId?: string;
        sessionKey?: string;
    }): void;
    /** Flush the write stream. */
    flush(): Promise<void>;
    /**
     * Read all entries from the audit log file, with duplicate entries removed.
     * Wrapping at this level means every route.ts read path gets dedupe for free
     * without needing to change 10 call sites.
     */
    readEntries(): AuditEntry[];
    /** Read entries with no post-processing. Used for hash-chain verification. */
    readEntriesRaw(): AuditEntry[];
    /** Verify the hash chain integrity of audit entries. */
    static verifyChain(entries: AuditEntry[]): {
        valid: boolean;
        brokenAt?: number;
    };
}
