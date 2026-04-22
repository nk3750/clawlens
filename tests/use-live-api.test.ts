// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * useLiveApi composes useApi + useSSE + debounce + visibilitychange. We mock
 * the two hook deps so tests can drive them synchronously without booting
 * EventSource (jsdom ships none) or the network layer.
 */
vi.mock("../dashboard/src/hooks/useApi", () => ({
  useApi: vi.fn(),
}));
vi.mock("../dashboard/src/hooks/useSSE", () => ({
  useSSE: vi.fn(),
}));

import { useApi } from "../dashboard/src/hooks/useApi";
import { useLiveApi } from "../dashboard/src/hooks/useLiveApi";
import { useSSE } from "../dashboard/src/hooks/useSSE";
import type { EntryResponse } from "../dashboard/src/lib/types";

const mockedUseApi = vi.mocked(useApi);
const mockedUseSSE = vi.mocked(useSSE);

let stableRefetch: ReturnType<typeof vi.fn>;
let capturedSSECallback: ((entry: EntryResponse) => void) | null = null;

function fakeEntry(overrides: Partial<EntryResponse> = {}): EntryResponse {
  return {
    timestamp: "2026-04-18T12:00:00.000Z",
    toolName: "exec",
    params: {},
    effectiveDecision: "allow",
    decision: "allow",
    riskScore: 30,
    // bare exec (no params.command) routes to the scripts fallback.
    category: "scripts",
    ...overrides,
  };
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  stableRefetch = vi.fn();
  capturedSSECallback = null;
  mockedUseApi.mockReturnValue({
    data: null,
    loading: false,
    error: null,
    refetch: stableRefetch,
  });
  mockedUseSSE.mockImplementation((_path, cb) => {
    capturedSSECallback = cb as (entry: EntryResponse) => void;
  });
  setVisibility("visible");
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("useLiveApi — initial subscription", () => {
  it("delegates fetching to useApi with the supplied path", () => {
    renderHook(() => useLiveApi<unknown>("api/stats"));
    expect(mockedUseApi).toHaveBeenCalledWith("api/stats");
  });

  it("subscribes to the api/stream SSE channel", () => {
    renderHook(() => useLiveApi<unknown>("api/stats"));
    expect(mockedUseSSE).toHaveBeenCalled();
    const call = mockedUseSSE.mock.calls[0];
    expect(call[0]).toBe("api/stream");
  });

  it("returns the same shape as useApi (data, loading, error, refetch)", () => {
    const { result } = renderHook(() => useLiveApi<unknown>("api/stats"));
    expect(result.current).toHaveProperty("data", null);
    expect(result.current).toHaveProperty("loading", false);
    expect(result.current).toHaveProperty("error", null);
    expect(typeof result.current.refetch).toBe("function");
  });

  it("does not call refetch on first mount (useApi handles initial fetch)", () => {
    renderHook(() => useLiveApi<unknown>("api/stats"));
    expect(stableRefetch).not.toHaveBeenCalled();
  });
});

describe("useLiveApi — SSE-driven refetch", () => {
  it("triggers a debounced refetch 500ms after an SSE entry", () => {
    renderHook(() => useLiveApi<unknown>("api/stats"));
    if (!capturedSSECallback) throw new Error("SSE callback not captured");

    act(() => {
      capturedSSECallback?.(fakeEntry());
    });
    expect(stableRefetch).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(stableRefetch).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(stableRefetch).toHaveBeenCalledTimes(1);
  });

  it("coalesces multiple SSE entries inside the debounce window into one refetch", () => {
    renderHook(() => useLiveApi<unknown>("api/agents"));
    if (!capturedSSECallback) throw new Error("SSE callback not captured");

    act(() => {
      capturedSSECallback?.(fakeEntry());
      vi.advanceTimersByTime(100);
      capturedSSECallback?.(fakeEntry());
      vi.advanceTimersByTime(100);
      capturedSSECallback?.(fakeEntry());
    });
    // Window restarted three times; nothing fired yet.
    expect(stableRefetch).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(stableRefetch).toHaveBeenCalledTimes(1);
  });

  it("honors a custom debounceMs option", () => {
    renderHook(() => useLiveApi<unknown>("api/stats", { debounceMs: 100 }));
    if (!capturedSSECallback) throw new Error("SSE callback not captured");

    act(() => {
      capturedSSECallback?.(fakeEntry());
    });
    act(() => {
      vi.advanceTimersByTime(99);
    });
    expect(stableRefetch).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(stableRefetch).toHaveBeenCalledTimes(1);
  });
});

describe("useLiveApi — filter predicate", () => {
  it("skips refetch when filter returns false", () => {
    renderHook(() =>
      useLiveApi<unknown>("api/attention", {
        filter: (e) => e.effectiveDecision === "block",
      }),
    );
    if (!capturedSSECallback) throw new Error("SSE callback not captured");

    act(() => {
      capturedSSECallback?.(fakeEntry({ effectiveDecision: "allow" }));
      vi.advanceTimersByTime(500);
    });
    expect(stableRefetch).not.toHaveBeenCalled();
  });

  it("triggers refetch when filter returns true", () => {
    renderHook(() =>
      useLiveApi<unknown>("api/attention", {
        filter: (e) => e.effectiveDecision === "block",
      }),
    );
    if (!capturedSSECallback) throw new Error("SSE callback not captured");

    act(() => {
      capturedSSECallback?.(fakeEntry({ effectiveDecision: "block" }));
      vi.advanceTimersByTime(500);
    });
    expect(stableRefetch).toHaveBeenCalledTimes(1);
  });

  it("filter blocks low-risk allow entries but admits high-risk allow entries", () => {
    renderHook(() =>
      useLiveApi<unknown>("api/attention", {
        filter: (e) => {
          const eff = e.effectiveDecision;
          const score = e.riskScore ?? 0;
          return eff === "pending" || eff === "block" || eff === "timeout" || score >= 65;
        },
      }),
    );
    if (!capturedSSECallback) throw new Error("SSE callback not captured");

    // low-risk allow: skip
    act(() => {
      capturedSSECallback?.(fakeEntry({ effectiveDecision: "allow", riskScore: 30 }));
      vi.advanceTimersByTime(500);
    });
    expect(stableRefetch).not.toHaveBeenCalled();

    // high-risk allow: admit
    act(() => {
      capturedSSECallback?.(fakeEntry({ effectiveDecision: "allow", riskScore: 70 }));
      vi.advanceTimersByTime(500);
    });
    expect(stableRefetch).toHaveBeenCalledTimes(1);
  });
});

describe("useLiveApi — visibilitychange refetch", () => {
  it("fires an immediate (non-debounced) refetch when the tab becomes visible", () => {
    renderHook(() => useLiveApi<unknown>("api/agents"));

    setVisibility("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    // No timer advance — should be immediate.
    expect(stableRefetch).toHaveBeenCalledTimes(1);
  });

  it("does not refetch when visibility transitions to hidden", () => {
    renderHook(() => useLiveApi<unknown>("api/agents"));

    setVisibility("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(stableRefetch).not.toHaveBeenCalled();
  });

  it("removes the visibilitychange listener on unmount", () => {
    const removeSpy = vi.spyOn(document, "removeEventListener");
    const { unmount } = renderHook(() => useLiveApi<unknown>("api/agents"));
    unmount();
    expect(removeSpy).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
    removeSpy.mockRestore();
  });
});

describe("useLiveApi — unmount cleanup", () => {
  it("does not invoke refetch after unmount even if a debounced timer was queued", () => {
    const { unmount } = renderHook(() => useLiveApi<unknown>("api/agents"));
    if (!capturedSSECallback) throw new Error("SSE callback not captured");

    act(() => {
      capturedSSECallback?.(fakeEntry());
    });

    unmount();

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(stableRefetch).not.toHaveBeenCalled();
  });
});
