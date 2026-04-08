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
export declare class AuditLogger extends EventEmitter {
    private filePath;
    private lastHash;
    private writeStream;
    constructor(filePath: string);
    init(): Promise<void>;
    private computeHash;
    /** Ensure write stream is open. Called lazily on first write. */
    private ensureStream;
    private append;
    /** Log a policy decision (from before_tool_call). */
    logDecision(data: AuditDecisionData): void;
    /** Log an approval resolution callback. */
    logApprovalResolution(data: {
        toolCallId?: string;
        toolName: string;
        approved: boolean;
        resolvedBy?: string;
    }): void;
    /** Log a tool call result (from after_tool_call). */
    logResult(data: {
        timestamp: string;
        toolName: string;
        toolCallId?: string;
        executionResult: "success" | "failure";
        durationMs?: number;
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
    }): void;
    /** Flush the write stream. */
    flush(): Promise<void>;
    /** Read all entries from the audit log file. */
    readEntries(): AuditEntry[];
    /** Verify the hash chain integrity of audit entries. */
    static verifyChain(entries: AuditEntry[]): {
        valid: boolean;
        brokenAt?: number;
    };
}
