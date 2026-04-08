export interface SessionAction {
    toolName: string;
    params: Record<string, unknown>;
    riskScore: number;
    timestamp: string;
}
export declare class SessionContext {
    private sessions;
    record(sessionKey: string, action: SessionAction): void;
    getRecent(sessionKey: string, count: number): SessionAction[];
    cleanup(sessionKey: string): void;
    /** Number of tracked sessions — useful for testing. */
    get size(): number;
}
