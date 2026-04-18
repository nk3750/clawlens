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

type StoredEntry = PendingApproval & { timer: NodeJS.Timeout | null };

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
export class PendingApprovalStore extends EventEmitter {
  private byToolCallId = new Map<string, StoredEntry>();

  put(entry: PendingApproval): void {
    const existing = this.byToolCallId.get(entry.toolCallId);
    if (existing?.timer) clearTimeout(existing.timer);

    const timer =
      entry.timeoutMs > 0
        ? setTimeout(() => {
            this.byToolCallId.delete(entry.toolCallId);
            this.emit("expire", entry.toolCallId);
          }, entry.timeoutMs)
        : null;

    this.byToolCallId.set(entry.toolCallId, { ...entry, timer });
    this.emit("put", entry.toolCallId);
  }

  /** Atomically remove + return. Single-winner semantics. */
  take(toolCallId: string): PendingApproval | undefined {
    const entry = this.byToolCallId.get(toolCallId);
    if (!entry) return undefined;
    if (entry.timer) clearTimeout(entry.timer);
    this.byToolCallId.delete(toolCallId);
    this.emit("take", toolCallId);
    const { timer: _timer, ...rest } = entry;
    return rest;
  }

  /** Peek without removing. */
  peek(toolCallId: string): PendingApproval | undefined {
    const entry = this.byToolCallId.get(toolCallId);
    if (!entry) return undefined;
    const { timer: _timer, ...rest } = entry;
    return rest;
  }

  size(): number {
    return this.byToolCallId.size;
  }

  /** Graceful shutdown — clears all timers. */
  shutdown(): void {
    for (const entry of this.byToolCallId.values()) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    this.byToolCallId.clear();
  }
}
