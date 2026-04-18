import { EventEmitter } from "node:events";
export interface PendingApproval {
    toolCallId: string;
    agentId: string;
    toolName: string;
    stashedAt: number;
    /** OpenClaw's timeoutMs at stash time. Our local timer matches. */
    timeoutMs: number;
    /** Wrapped onResolution. Calling this fires the real callback and cleans our stash. */
    resolve: (decision: string) => Promise<void>;
}
/**
 * In-memory stash of pending approval resolver closures, keyed by toolCallId.
 *
 * OpenClaw exposes approval resolution as a single `onResolution` closure that
 * only lives inside the synchronous `before_tool_call` window. The dashboard
 * needs to call that closure from a later HTTP request — so we keep a strong
 * reference here until one of three things happens:
 *   1. Dashboard POSTs /api/attention/resolve → `take()` → resolver fires.
 *   2. Telegram resolves first → the hook's wrapper calls `take()` → no-op.
 *   3. Local timer expires (matches OpenClaw's timeoutMs) → evict + "expire".
 *
 * `take()` is atomic (Map.delete + return) — this is what gives us
 * single-winner semantics across the three paths above.
 */
export declare class PendingApprovalStore extends EventEmitter {
    private byToolCallId;
    put(entry: PendingApproval): void;
    /** Atomically remove + return. Single-winner semantics. */
    take(toolCallId: string): PendingApproval | undefined;
    /** Peek without removing. */
    peek(toolCallId: string): PendingApproval | undefined;
    size(): number;
    /** Graceful shutdown — clears all timers. */
    shutdown(): void;
}
