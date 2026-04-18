import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type PendingApproval, PendingApprovalStore } from "../src/hooks/pending-approval-store";

function makeEntry(overrides: Partial<PendingApproval> = {}): PendingApproval {
  return {
    toolCallId: "tc_1",
    agentId: "alpha",
    toolName: "exec",
    stashedAt: Date.now(),
    timeoutMs: 300_000,
    resolve: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("PendingApprovalStore", () => {
  let store: PendingApprovalStore;

  beforeEach(() => {
    store = new PendingApprovalStore();
  });

  afterEach(() => {
    store.shutdown();
  });

  describe("put / size / peek", () => {
    it("put() records an entry reachable by toolCallId", () => {
      const entry = makeEntry();
      store.put(entry);
      expect(store.size()).toBe(1);
      expect(store.peek("tc_1")?.toolCallId).toBe("tc_1");
    });

    it("put() emits a 'put' event with the toolCallId", () => {
      const spy = vi.fn();
      store.on("put", spy);
      store.put(makeEntry({ toolCallId: "tc_evt" }));
      expect(spy).toHaveBeenCalledWith("tc_evt");
    });

    it("peek() returns undefined for unknown keys", () => {
      expect(store.peek("missing")).toBeUndefined();
    });

    it("peek() does not mutate the store", () => {
      store.put(makeEntry({ toolCallId: "tc_peek" }));
      store.peek("tc_peek");
      store.peek("tc_peek");
      expect(store.size()).toBe(1);
    });

    it("peek() does not leak the internal timer field", () => {
      store.put(makeEntry({ toolCallId: "tc_peek_shape" }));
      const peeked = store.peek("tc_peek_shape") as Record<string, unknown>;
      expect(peeked).toBeDefined();
      expect(peeked).not.toHaveProperty("timer");
    });

    it("put() on an existing key replaces the entry and clears the prior timer", () => {
      vi.useFakeTimers();
      try {
        const first = makeEntry({ toolCallId: "tc_dup", timeoutMs: 5_000 });
        const second = makeEntry({ toolCallId: "tc_dup", timeoutMs: 10_000 });
        const expire = vi.fn();
        store.on("expire", expire);

        store.put(first);
        // Advance past the first timer — must NOT fire because replaced.
        store.put(second);
        vi.advanceTimersByTime(6_000);
        expect(expire).not.toHaveBeenCalled();

        // Advance to the second timer boundary — this one should still fire.
        vi.advanceTimersByTime(5_000);
        expect(expire).toHaveBeenCalledWith("tc_dup");
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("take — single-winner", () => {
    it("take() returns the stored entry and removes it from the store", () => {
      const entry = makeEntry({ toolCallId: "tc_take" });
      store.put(entry);
      const taken = store.take("tc_take");
      expect(taken?.toolCallId).toBe("tc_take");
      expect(taken?.resolve).toBe(entry.resolve);
      expect(store.size()).toBe(0);
    });

    it("take() emits a 'take' event with the toolCallId", () => {
      const spy = vi.fn();
      store.on("take", spy);
      store.put(makeEntry({ toolCallId: "tc_evt2" }));
      store.take("tc_evt2");
      expect(spy).toHaveBeenCalledWith("tc_evt2");
    });

    it("a second take() on the same key returns undefined (single-winner)", () => {
      store.put(makeEntry({ toolCallId: "tc_race" }));
      const first = store.take("tc_race");
      const second = store.take("tc_race");
      expect(first).toBeDefined();
      expect(second).toBeUndefined();
    });

    it("take() of an unknown key returns undefined without emitting", () => {
      const spy = vi.fn();
      store.on("take", spy);
      expect(store.take("nope")).toBeUndefined();
      expect(spy).not.toHaveBeenCalled();
    });

    it("take() does not leak the internal timer field in the returned entry", () => {
      store.put(makeEntry({ toolCallId: "tc_shape" }));
      const taken = store.take("tc_shape") as Record<string, unknown>;
      expect(taken).toBeDefined();
      expect(taken).not.toHaveProperty("timer");
    });

    it("take() clears the pending expiry timer", () => {
      vi.useFakeTimers();
      try {
        const expire = vi.fn();
        store.on("expire", expire);
        store.put(makeEntry({ toolCallId: "tc_take_clear", timeoutMs: 5_000 }));
        store.take("tc_take_clear");
        vi.advanceTimersByTime(10_000);
        expect(expire).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("expiry", () => {
    it("emits 'expire' and evicts the entry after timeoutMs", () => {
      vi.useFakeTimers();
      try {
        const expire = vi.fn();
        store.on("expire", expire);
        store.put(makeEntry({ toolCallId: "tc_expire", timeoutMs: 1_000 }));
        expect(store.size()).toBe(1);

        vi.advanceTimersByTime(1_000);
        expect(expire).toHaveBeenCalledWith("tc_expire");
        expect(store.size()).toBe(0);
        expect(store.peek("tc_expire")).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not schedule a timer when timeoutMs is 0", () => {
      vi.useFakeTimers();
      try {
        const expire = vi.fn();
        store.on("expire", expire);
        store.put(makeEntry({ toolCallId: "tc_no_timer", timeoutMs: 0 }));
        vi.advanceTimersByTime(60_000);
        expect(expire).not.toHaveBeenCalled();
        // Entry is still present — it just never self-evicts.
        expect(store.peek("tc_no_timer")?.toolCallId).toBe("tc_no_timer");
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("shutdown", () => {
    it("clears all entries and prevents pending timers from firing", () => {
      vi.useFakeTimers();
      try {
        const expire = vi.fn();
        store.on("expire", expire);
        store.put(makeEntry({ toolCallId: "tc_a", timeoutMs: 5_000 }));
        store.put(makeEntry({ toolCallId: "tc_b", timeoutMs: 5_000 }));
        expect(store.size()).toBe(2);

        store.shutdown();
        expect(store.size()).toBe(0);

        vi.advanceTimersByTime(10_000);
        expect(expire).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("is idempotent — calling twice does not throw", () => {
      store.put(makeEntry());
      store.shutdown();
      expect(() => store.shutdown()).not.toThrow();
      expect(store.size()).toBe(0);
    });
  });
});
