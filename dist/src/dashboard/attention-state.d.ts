/**
 * Attention acknowledgment state — append-only JSONL side-file. Not part of
 * the audit hash chain: these are user actions (review / dismiss), not
 * security-relevant events. Kept separate so the audit log stays canonical.
 *
 * Single-writer assumption: the gateway is single-process. If we ever go
 * multi-process, swap this for SQLite.
 */
export type AckScope = {
    kind: "entry";
    toolCallId: string;
} | {
    kind: "agent";
    agentId: string;
    upToIso: string;
};
export interface AckRecord {
    id: string;
    scope: AckScope;
    ackedAt: string;
    ackedBy?: string;
    action: "ack" | "dismiss";
    note?: string;
}
/** True when `scope` is a structurally valid AckScope. Used for route body validation. */
export declare function isValidAckScope(scope: unknown): scope is AckScope;
export declare class AttentionStore {
    private cache;
    private filePath;
    constructor(filePath: string);
    /**
     * Append a record synchronously. The gateway needs read-your-own-writes —
     * an ack received over HTTP must be visible to the next GET /api/attention
     * in the same event loop. appendFileSync guarantees that; async fire-and-
     * forget does not.
     */
    append(record: AckRecord): void;
    /** Load all records, caching on first read. */
    loadAll(): AckRecord[];
    /** Return the most-recent record for the given toolCallId, if any. */
    isAckedEntry(toolCallId: string): AckRecord | null;
    /**
     * Agent-level ack/dismiss: covered only when an ack exists whose `upToIso`
     * is >= the event timestamp. A newer triggering event past that upToIso
     * re-raises the agent in the inbox.
     */
    isAckedAgent(agentId: string, eventIso: string): AckRecord | null;
    /** Generate a new ack record ID. */
    static generateId(): string;
}
