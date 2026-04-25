// @vitest-environment jsdom

/**
 * Tests for `useGatewayHealth` — the lightweight 10s polling hook that
 * powers the Nav-bar gateway dot. Replaces the SSE-based liveness chrome.
 *
 * Spec §2 (gateway-health-poll-spec):
 *   - 10s poll cadence
 *   - 5s timeout per request
 *   - 2 consecutive failures flips status `unknown`/`ok` → `down`
 *   - `unknown` is the initial state; never reverts to `unknown` once a poll
 *     has produced a verdict
 *   - aborts in-flight requests on unmount (cleanup)
 *   - aborts the prior in-flight request when the next poll starts
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useGatewayHealth } from "../dashboard/src/hooks/useGatewayHealth";

interface FetchResponseInit {
  ok: boolean;
  status?: number;
  body?: unknown;
}

function fakeResponse({ ok, status = 200, body = {} }: FetchResponseInit): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("useGatewayHealth — initial state", () => {
  it("starts in 'unknown' before the first poll resolves", () => {
    // Never-resolving fetch keeps the first poll pending so we can read
    // the freshly-rendered state.
    fetchMock.mockReturnValue(new Promise<Response>(() => {}));
    const { result } = renderHook(() => useGatewayHealth({ fetchImpl: fetchMock as typeof fetch }));
    expect(result.current).toBe("unknown");
  });
});

describe("useGatewayHealth — happy path", () => {
  it("transitions to 'ok' after the first successful poll", async () => {
    fetchMock.mockResolvedValue(fakeResponse({ ok: true, body: { valid: true, totalEntries: 0 } }));
    const { result } = renderHook(() => useGatewayHealth({ fetchImpl: fetchMock as typeof fetch }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current).toBe("ok");
  });

  it("recovers from 'down' to 'ok' after a successful poll", async () => {
    // Two failures (→down), then a success (→ok).
    fetchMock
      .mockResolvedValueOnce(fakeResponse({ ok: false, status: 500 }))
      .mockResolvedValueOnce(fakeResponse({ ok: false, status: 500 }))
      .mockResolvedValueOnce(fakeResponse({ ok: true, body: { valid: true, totalEntries: 1 } }));

    const { result } = renderHook(() =>
      useGatewayHealth({ fetchImpl: fetchMock as typeof fetch, pollMs: 1000 }),
    );

    // First poll fires immediately on mount.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // 2nd poll: cumulative 2 failures → "down".
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current).toBe("down");

    // 3rd poll: success resets failures and flips back to "ok".
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current).toBe("ok");
  });
});

describe("useGatewayHealth — failure threshold", () => {
  it("flips to 'down' only after `failureThreshold` consecutive failures", async () => {
    fetchMock.mockResolvedValue(fakeResponse({ ok: false, status: 503 }));
    const { result } = renderHook(() =>
      useGatewayHealth({
        fetchImpl: fetchMock as typeof fetch,
        pollMs: 1000,
        failureThreshold: 2,
      }),
    );

    // First failure — under threshold. Status stays "unknown".
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current).toBe("unknown");

    // Second failure — threshold reached. Status flips to "down".
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current).toBe("down");
  });

  it("does NOT flicker to 'down' on a single failure after a success", async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse({ ok: true, body: { valid: true, totalEntries: 0 } }))
      .mockResolvedValueOnce(fakeResponse({ ok: false, status: 502 }));

    const { result } = renderHook(() =>
      useGatewayHealth({
        fetchImpl: fetchMock as typeof fetch,
        pollMs: 1000,
        failureThreshold: 2,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current).toBe("ok");

    // Single failure — threshold (2) not reached. Should remain "ok".
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current).toBe("ok");
  });
});

describe("useGatewayHealth — cleanup", () => {
  it("aborts the in-flight request on unmount", () => {
    let captured: AbortSignal | undefined;
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      captured = init?.signal ?? undefined;
      return new Promise<Response>(() => {}); // never resolves
    });

    const { unmount } = renderHook(() =>
      useGatewayHealth({ fetchImpl: fetchMock as typeof fetch }),
    );
    expect(captured).toBeDefined();
    expect(captured?.aborted).toBe(false);

    unmount();
    expect(captured?.aborted).toBe(true);
  });

  it("aborts the prior in-flight request when the next poll starts", async () => {
    const signals: AbortSignal[] = [];
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.signal) signals.push(init.signal);
      return new Promise<Response>(() => {}); // never resolves either call
    });

    renderHook(() => useGatewayHealth({ fetchImpl: fetchMock as typeof fetch, pollMs: 1000 }));

    // First poll starts immediately — its signal must not be aborted yet.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(signals).toHaveLength(1);
    expect(signals[0].aborted).toBe(false);

    // Advance past the poll cadence so the second poll fires. Doing so must
    // synchronously abort the prior controller before the next fetch starts.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(signals).toHaveLength(2);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });
});
