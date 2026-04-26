// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import type { ActivityCategory, EntryResponse } from "../dashboard/src/lib/types";
import Activity from "../dashboard/src/pages/Activity";

function jsonResp(data: unknown) {
  return { ok: true, status: 200, json: async () => data };
}

function entry(i: number): EntryResponse {
  return {
    timestamp: new Date(Date.now() - i * 1000).toISOString(),
    toolName: "exec",
    toolCallId: `tc_${i}`,
    params: { command: `echo ${i}` },
    effectiveDecision: "allow",
    category: "scripts" as ActivityCategory,
    agentId: "baddie",
    riskTier: "low",
    riskScore: 10,
  };
}

const FIRST_PAGE = Array.from({ length: 50 }, (_, i) => entry(i));
const SECOND_PAGE = Array.from({ length: 30 }, (_, i) => entry(50 + i));

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes("/api/agents")) return jsonResp([]);
    if (url.includes("limit=200")) return jsonResp([]); // count basis
    if (url.includes("limit=50") && url.includes("offset=50")) {
      return jsonResp(SECOND_PAGE);
    }
    if (url.includes("limit=50")) {
      // First displayed-feed page (offset=0)
      return jsonResp(FIRST_PAGE);
    }
    return jsonResp([]);
  });
});

afterEach(() => {
  fetchMock.mockReset();
});

function mountActivity() {
  return render(
    <MemoryRouter initialEntries={["/activity"]}>
      <Routes>
        <Route path="/activity" element={<Activity />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Activity — Load more pagination", () => {
  it("renders Load more after the initial 50 entries", async () => {
    mountActivity();
    await waitFor(() => expect(screen.getByTestId("load-more-btn")).toBeInTheDocument());
    expect(screen.getByTestId("feed-count").textContent).toContain("50");
  });

  it("clicking Load more appends the next page and bumps the displayed count", async () => {
    mountActivity();
    await waitFor(() => expect(screen.getByTestId("load-more-btn")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("load-more-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("feed-count").textContent).toContain("80");
    });
  });

  it("hides Load more after the API returns a partial page (<50)", async () => {
    mountActivity();
    await waitFor(() => expect(screen.getByTestId("load-more-btn")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("load-more-btn"));

    await waitFor(() => expect(screen.queryByTestId("load-more-btn")).toBeNull());
  });

  it("the second fetch URL carries offset=50", async () => {
    mountActivity();
    await waitFor(() => expect(screen.getByTestId("load-more-btn")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("load-more-btn"));

    await waitFor(() => {
      const calls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(calls.some((u) => u.includes("offset=50"))).toBe(true);
    });
  });

  it("Load more is hidden when the initial page returns <50 entries", async () => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/api/agents")) return jsonResp([]);
      if (url.includes("limit=200")) return jsonResp([]);
      if (url.includes("limit=50")) return jsonResp(Array.from({ length: 12 }, (_, i) => entry(i)));
      return jsonResp([]);
    });
    mountActivity();
    // Wait for the feed-count to appear (initial fetch resolved).
    await waitFor(() => expect(screen.getByTestId("feed-count").textContent).toContain("12"));
    expect(screen.queryByTestId("load-more-btn")).toBeNull();
  });
});
