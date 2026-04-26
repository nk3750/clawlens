// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

// Stub fetch — Activity calls /api/entries (×2: count basis + displayed feed)
// and /api/agents during mount; return empty payloads so the page renders an
// empty state. Each test can override via fetchMock.mockResolvedValueOnce.
const fetchMock = vi.fn(async () => ({
  ok: true,
  status: 200,
  json: async () => [],
}));
vi.stubGlobal("fetch", fetchMock);

import Activity from "../dashboard/src/pages/Activity";

afterEach(() => {
  fetchMock.mockClear();
});

beforeEach(() => {
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

describe("Activity — URL → filter state seeding", () => {
  it("seeds filter state from URL params on mount", async () => {
    renderActivityAt("/activity?agent=baddie&tier=critical");

    // The seeded filters appear as chips in the active-filter strip. Tier
    // labels uppercase per design; assert via case-insensitive regex.
    await waitFor(() => {
      expect(screen.getByTestId("active-chip-agent").textContent).toMatch(/baddie/);
      expect(screen.getByTestId("active-chip-tier").textContent).toMatch(/critical/i);
    });
  });

  it("renders chips for every URL filter — including unknown values", async () => {
    renderActivityAt("/activity?tier=banana");
    // ?tier=banana — chip renders so the operator sees what they typed; results 0.
    await waitFor(() => {
      const chip = screen.getByTestId("active-chip-tier");
      // Tier labels uppercase per labelFor, but the user-typed value survives.
      expect(chip.textContent).toMatch(/banana/i);
    });
  });

  it("first /api/entries call defaults to since=24h when no filters are set", async () => {
    renderActivityAt("/activity");

    await waitFor(() => {
      const calls = fetchMock.mock.calls.map((c) => String(c[0]));
      // Find the displayed-feed call (limit=50). The count-basis call uses
      // limit=200; we only care about the displayed feed here.
      const entriesCall = calls.find((u) => u.includes("/api/entries") && u.includes("limit=50"));
      expect(entriesCall).toBeDefined();
      expect(entriesCall!).toContain("since=24h");
    });
  });

  it("renders no active-filter strip when URL is empty", async () => {
    renderActivityAt("/activity");
    await waitFor(() => expect(screen.queryByTestId("active-filter-strip")).toBeNull());
  });
});

describe("Activity — filter change → URL update", () => {
  it("clicking the chip × removes the filter and updates the URL (replace, not push)", async () => {
    renderActivityAt("/activity?agent=baddie&tier=critical");

    await waitFor(() => expect(screen.getByTestId("active-chip-agent")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("active-chip-agent-remove"));

    await waitFor(() => {
      const loc = screen.getByTestId("location").textContent ?? "";
      expect(loc).toContain("tier=critical");
      expect(loc).not.toContain("agent=baddie");
    });
  });

  it("clicking CLEAR ALL drops every filter from the URL", async () => {
    renderActivityAt("/activity?agent=baddie&tier=critical&since=24h");

    await waitFor(() => expect(screen.getByTestId("active-filter-clear-all")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("active-filter-clear-all"));

    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe("/activity");
    });
  });

  it("clicking a preset chip replaces filters with the preset's shape", async () => {
    renderActivityAt("/activity");

    const preset = await screen.findByTestId("preset-critical-only");
    fireEvent.click(preset);

    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe("/activity?tier=critical");
    });
  });
});
