// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EntryResponse } from "../dashboard/src/lib/types";

// Stub EventSource — Activity uses useSSE, which constructs one on mount.
class EventSourceShim {
  url: string;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  readyState = 0;
  constructor(url: string) {
    this.url = url;
  }
  close() {}
  addEventListener() {}
  removeEventListener() {}
}
vi.stubGlobal("EventSource", EventSourceShim);

/**
 * Phase 2.7 (#35) — fetch stub returns at least one entry so ActivityFeed
 * stays mounted across refetches. ActivityFeed swaps to <ActivityFeedSkeleton>
 * when `displayedLoading && entries.length === 0`; an empty fetch would unmount
 * SearchInput on every URL change, resetting its local text state and breaking
 * the debounce contract under test.
 */
const SAMPLE_ENTRY: EntryResponse = {
  timestamp: new Date().toISOString(),
  toolName: "exec",
  params: { command: "echo hi" },
  effectiveDecision: "allow",
  category: "scripts",
  agentId: "alpha",
  sessionKey: "sess_a",
  toolCallId: "tc_sample",
};

// Per-URL responses: /api/entries returns the sample so ActivityFeed stays
// mounted; everything else (notably /api/agents) returns []. Activity expects
// AgentInfo[] from /api/agents — feeding it EntryResponse[] crashes
// GradientAvatar inside FilterRail on a missing `id`.
const fetchMock = vi.fn(async (input: unknown) => {
  const url = typeof input === "string" ? input : "";
  const body = url.includes("/api/entries") ? [SAMPLE_ENTRY] : [];
  return {
    ok: true,
    status: 200,
    json: async () => body,
  };
});
vi.stubGlobal("fetch", fetchMock);

import Activity from "../dashboard/src/pages/Activity";

beforeEach(() => {
  vi.useRealTimers();
  fetchMock.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  fetchMock.mockClear();
});

function LocationProbe() {
  const loc = useLocation();
  return (
    <span data-testid="location">
      {loc.pathname}
      {loc.search}
    </span>
  );
}

function renderActivityAt(initial: string) {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <LocationProbe />
      <Routes>
        <Route path="/activity" element={<Activity />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("SearchInput (Phase 2.7, #35)", () => {
  it("renders with placeholder 'search entries' and a magnifying-glass icon", async () => {
    renderActivityAt("/activity");
    const input = (await screen.findByTestId("activity-search-input")) as HTMLInputElement;
    expect(input.placeholder).toBe("search entries");
    expect(screen.getByTestId("activity-search-icon")).toBeInTheDocument();
  });

  it("input enforces maxLength=200", async () => {
    renderActivityAt("/activity");
    const input = (await screen.findByTestId("activity-search-input")) as HTMLInputElement;
    expect(input.maxLength).toBe(200);
  });

  it("seeds the input from ?q= on mount", async () => {
    renderActivityAt("/activity?q=ssh");
    const input = (await screen.findByTestId("activity-search-input")) as HTMLInputElement;
    expect(input.value).toBe("ssh");
  });

  it("typing reflects in input immediately (controlled)", async () => {
    renderActivityAt("/activity");
    const input = (await screen.findByTestId("activity-search-input")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "ssh" } });
    expect(input.value).toBe("ssh");
  });

  it("clear (×) button is hidden when input is empty", async () => {
    renderActivityAt("/activity");
    await screen.findByTestId("activity-search-input");
    expect(screen.queryByTestId("activity-search-clear")).toBeNull();
  });

  it("clear (×) button appears when input is non-empty and clears the input + URL on click", async () => {
    renderActivityAt("/activity?q=ssh");
    const input = (await screen.findByTestId("activity-search-input")) as HTMLInputElement;
    expect(input.value).toBe("ssh");

    const clear = await screen.findByTestId("activity-search-clear");
    fireEvent.click(clear);

    await waitFor(() => {
      expect((screen.getByTestId("activity-search-input") as HTMLInputElement).value).toBe("");
      const loc = screen.getByTestId("location").textContent ?? "";
      expect(loc).not.toContain("q=");
    });
  });

  it("debounces URL update by 200ms", async () => {
    renderActivityAt("/activity");
    await screen.findByTestId("activity-search-input");

    vi.useFakeTimers();
    try {
      // Always re-query after entering fake timers — Activity may re-render
      // and any stored DOM ref can become detached. Same defense applies in
      // every fake-timer test below.
      const input = screen.getByTestId("activity-search-input") as HTMLInputElement;
      await act(async () => {
        fireEvent.change(input, { target: { value: "ssh" } });
      });

      await act(async () => {
        vi.advanceTimersByTime(150);
      });
      expect(screen.getByTestId("location").textContent ?? "").not.toContain("q=ssh");

      await act(async () => {
        vi.advanceTimersByTime(60);
      });
      expect(screen.getByTestId("location").textContent ?? "").toContain("q=ssh");
    } finally {
      vi.useRealTimers();
    }
  });

  it("typing then clearing the field omits q from the URL (no ?q=)", async () => {
    renderActivityAt("/activity");
    await screen.findByTestId("activity-search-input");

    vi.useFakeTimers();
    try {
      const input = screen.getByTestId("activity-search-input") as HTMLInputElement;
      await act(async () => {
        fireEvent.change(input, { target: { value: "ssh" } });
      });
      await act(async () => {
        vi.advanceTimersByTime(220);
      });
      expect(screen.getByTestId("location").textContent ?? "").toContain("q=ssh");

      const input2 = screen.getByTestId("activity-search-input") as HTMLInputElement;
      await act(async () => {
        fireEvent.change(input2, { target: { value: "" } });
      });
      await act(async () => {
        vi.advanceTimersByTime(220);
      });
      expect(screen.getByTestId("location").textContent ?? "").not.toContain("q=");
    } finally {
      vi.useRealTimers();
    }
  });

  it("rapid keystrokes only update the URL once after the burst settles", async () => {
    renderActivityAt("/activity");
    await screen.findByTestId("activity-search-input");

    vi.useFakeTimers();
    try {
      let input = screen.getByTestId("activity-search-input") as HTMLInputElement;
      await act(async () => {
        fireEvent.change(input, { target: { value: "s" } });
      });
      await act(async () => {
        vi.advanceTimersByTime(50);
      });
      input = screen.getByTestId("activity-search-input") as HTMLInputElement;
      await act(async () => {
        fireEvent.change(input, { target: { value: "ss" } });
      });
      await act(async () => {
        vi.advanceTimersByTime(50);
      });
      input = screen.getByTestId("activity-search-input") as HTMLInputElement;
      await act(async () => {
        fireEvent.change(input, { target: { value: "ssh" } });
      });
      await act(async () => {
        vi.advanceTimersByTime(100);
      });

      // Total elapsed = 200ms, but the last keystroke was 100ms ago — URL
      // should NOT have updated yet.
      expect(screen.getByTestId("location").textContent ?? "").not.toContain("q=");

      // 100ms more pushes the last keystroke past the 200ms threshold.
      await act(async () => {
        vi.advanceTimersByTime(120);
      });
      const loc = screen.getByTestId("location").textContent ?? "";
      expect(loc).toContain("q=ssh");
      expect(loc).not.toContain("q=ss&");
    } finally {
      vi.useRealTimers();
    }
  });
});
