// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── EventSource stub — Activity uses useSSE on mount ───
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

// ─── fetch stub — empty payload by default; tests override per-suite ───
const fetchMock = vi.fn(async () => ({
  ok: true,
  status: 200,
  json: async () => [],
}));
vi.stubGlobal("fetch", fetchMock);

// ─── matchMedia stub — computes match from a simulated viewport width ───
type MqlListener = (e: MediaQueryListEvent) => void;

interface FakeMql {
  matches: boolean;
  media: string;
  onchange: MqlListener | null;
  addEventListener: (type: "change", cb: MqlListener) => void;
  removeEventListener: (type: "change", cb: MqlListener) => void;
}

function matchesQuery(query: string, width: number): boolean {
  const m = query.match(/\(\s*max-width:\s*(\d+)px\s*\)/);
  if (m) return width <= Number.parseInt(m[1], 10);
  return false;
}

function installViewport(width: number): void {
  const cache = new Map<string, FakeMql>();
  const factory = vi.fn().mockImplementation((query: string): FakeMql => {
    const existing = cache.get(query);
    if (existing) return existing;
    const listeners = new Set<MqlListener>();
    const mql: FakeMql = {
      matches: matchesQuery(query, width),
      media: query,
      onchange: null,
      addEventListener: (type, cb) => {
        if (type === "change") listeners.add(cb);
      },
      removeEventListener: (type, cb) => {
        if (type === "change") listeners.delete(cb);
      },
    };
    cache.set(query, mql);
    return mql;
  });
  vi.stubGlobal("matchMedia", factory);
  // biome-ignore lint/suspicious/noExplicitAny: stub a Web API on the test window
  (window as any).matchMedia = factory;
}

import type { ActivityCategory, EntryResponse } from "../dashboard/src/lib/types";
import Activity from "../dashboard/src/pages/Activity";

const SAMPLE_ENTRIES: EntryResponse[] = [
  {
    timestamp: new Date("2026-04-26T18:00:00.000Z").toISOString(),
    toolName: "exec",
    toolCallId: "tc_1",
    params: { command: "ls -la" },
    effectiveDecision: "allow",
    category: "scripts" as ActivityCategory,
    agentId: "alpha",
    sessionKey: "agent:alpha:session:abc#1",
    riskTier: "high",
    riskScore: 60,
    riskTags: ["destructive"],
  },
  {
    timestamp: new Date("2026-04-26T18:00:01.000Z").toISOString(),
    toolName: "exec",
    toolCallId: "tc_2",
    params: { command: "cat README.md" },
    effectiveDecision: "allow",
    category: "exploring" as ActivityCategory,
    agentId: "alpha",
    sessionKey: "agent:alpha:session:abc#1",
    riskTier: "low",
    riskScore: 5,
    riskTags: ["readonly"],
  },
];

function setupFetchEntries(entries: EntryResponse[]): void {
  fetchMock.mockImplementation(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () => {
      if (url.includes("/api/entries")) return entries;
      if (url.includes("/api/agents")) return [];
      if (url.includes("/api/saved-searches")) return [];
      return [];
    },
  }));
}

beforeEach(() => {
  fetchMock.mockClear();
  setupFetchEntries(SAMPLE_ENTRIES);
});

afterEach(() => {
  vi.unstubAllGlobals();
  // Re-stub the EventSource and fetch globals so the next test doesn't crash
  // before its installViewport() call runs.
  vi.stubGlobal("EventSource", EventSourceShim);
  vi.stubGlobal("fetch", fetchMock);
  // Restore body overflow in case a drawer test left it locked.
  document.body.style.overflow = "";
});

function renderActivity() {
  return render(
    <MemoryRouter initialEntries={["/activity"]}>
      <Routes>
        <Route path="/activity" element={<Activity />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Activity — desktop (1280px)", () => {
  it("hamburger NOT in DOM, HeaderMixBar visible, inline tags rendered, LIVE label visible", async () => {
    installViewport(1280);
    renderActivity();
    await waitFor(() =>
      expect(screen.getAllByTestId("activity-row-root").length).toBeGreaterThan(0),
    );

    expect(screen.queryByTestId("activity-drawer-toggle")).toBeNull();
    expect(screen.getByTestId("header-mix-bar")).toBeInTheDocument();
    expect(screen.getAllByTestId(/^activity-row-tag-/).length).toBeGreaterThan(0);
    expect(screen.getByTestId("live-pause-toggle").textContent ?? "").toMatch(/LIVE/);
  });

  it("grid template columns are 244px 1fr at desktop", async () => {
    installViewport(1280);
    renderActivity();
    await waitFor(() => expect(screen.getByTestId("activity-grid")).toBeInTheDocument());
    const grid = screen.getByTestId("activity-grid");
    expect(grid.style.gridTemplateColumns).toBe("244px 1fr");
  });
});

describe("Activity — drawer breakpoint (1023px)", () => {
  it("hamburger IN DOM, HeaderMixBar hidden, grid is 1fr", async () => {
    installViewport(1023);
    renderActivity();
    await waitFor(() => expect(screen.getByTestId("activity-drawer-toggle")).toBeInTheDocument());

    expect(screen.queryByTestId("header-mix-bar")).toBeNull();
    expect(screen.getByTestId("activity-grid").style.gridTemplateColumns).toBe("1fr");
  });

  it("hamburger toggle opens the drawer with FilterRail inside", async () => {
    installViewport(1023);
    renderActivity();
    await waitFor(() => expect(screen.getByTestId("activity-drawer-toggle")).toBeInTheDocument());

    expect(screen.queryByTestId("activity-drawer")).toBeNull();
    fireEvent.click(screen.getByTestId("activity-drawer-toggle"));
    const drawer = await screen.findByTestId("activity-drawer");
    expect(within(drawer).getByTestId("filter-rail")).toBeInTheDocument();
  });

  it("ESC keydown closes the drawer", async () => {
    installViewport(1023);
    renderActivity();
    fireEvent.click(await screen.findByTestId("activity-drawer-toggle"));
    await screen.findByTestId("activity-drawer");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("activity-drawer")).toBeNull());
  });

  it("backdrop click closes the drawer", async () => {
    installViewport(1023);
    renderActivity();
    fireEvent.click(await screen.findByTestId("activity-drawer-toggle"));
    await screen.findByTestId("activity-drawer");

    fireEvent.click(screen.getByTestId("activity-drawer-backdrop"));
    await waitFor(() => expect(screen.queryByTestId("activity-drawer")).toBeNull());
  });

  it("body overflow is hidden while drawer is open and restored on close", async () => {
    installViewport(1023);
    renderActivity();
    await waitFor(() => expect(screen.getByTestId("activity-drawer-toggle")).toBeInTheDocument());

    const initial = document.body.style.overflow;
    fireEvent.click(screen.getByTestId("activity-drawer-toggle"));
    await screen.findByTestId("activity-drawer");
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("activity-drawer")).toBeNull());
    expect(document.body.style.overflow).toBe(initial);
  });
});

describe("Activity — compact (767px)", () => {
  it("HeaderMixBar gone, LIVE-text gone (only dot), inline tags gone from rows", async () => {
    installViewport(767);
    renderActivity();
    await waitFor(() =>
      expect(screen.getAllByTestId("activity-row-root").length).toBeGreaterThan(0),
    );

    expect(screen.queryByTestId("header-mix-bar")).toBeNull();
    // LIVE/PAUSED label dropped — only the colored dot remains.
    expect(screen.getByTestId("live-pause-toggle").textContent ?? "").not.toMatch(/LIVE|PAUSED/);
    // Inline tags removed at compact (operators reach tags via expand).
    expect(screen.queryAllByTestId(/^activity-row-tag-/).length).toBe(0);
  });

  it("clicking a row reveals quick-actions + tier-info; clicking another row swaps which one is shown", async () => {
    installViewport(767);
    renderActivity();
    await waitFor(() =>
      expect(screen.getAllByTestId("activity-row-root").length).toBeGreaterThanOrEqual(2),
    );

    const rows = screen.getAllByTestId("activity-row-root");
    expect(screen.queryByTestId("activity-row-quick-actions")).toBeNull();

    // Tap row 0 → quick-actions visible
    fireEvent.click(rows[0]);
    expect(screen.getAllByTestId("activity-row-quick-actions").length).toBe(1);
    expect(screen.getAllByTestId("activity-row-tier-info-strip").length).toBe(1);

    // Tap row 1 → row 0's strip vanishes, row 1's appears (single tappedId)
    fireEvent.click(rows[1]);
    expect(screen.getAllByTestId("activity-row-quick-actions").length).toBe(1);
    expect(screen.getAllByTestId("activity-row-tier-info-strip").length).toBe(1);

    // Tap row 1 again → both vanish
    fireEvent.click(rows[1]);
    expect(screen.queryByTestId("activity-row-quick-actions")).toBeNull();
    expect(screen.queryByTestId("activity-row-tier-info-strip")).toBeNull();
  });
});

describe("Activity — narrow (639px)", () => {
  it("title font-size shrinks to 24px", async () => {
    installViewport(639);
    renderActivity();
    const title = await screen.findByText("Activity");
    expect(title.style.fontSize).toBe("24px");
  });

  it("row root uses column flex-direction at narrow viewport", async () => {
    installViewport(390);
    renderActivity();
    const row = await waitFor(() => {
      const found = screen.queryAllByTestId("activity-row-root");
      if (found.length === 0) throw new Error("row not yet rendered");
      return found[0];
    });
    expect(row.style.flexDirection).toBe("column");
  });
});

describe("Activity — drawer focus trap", () => {
  it("Tab from last focusable in drawer wraps to first; Shift+Tab from first wraps to last", async () => {
    installViewport(1023);
    renderActivity();
    fireEvent.click(await screen.findByTestId("activity-drawer-toggle"));
    const drawer = await screen.findByTestId("activity-drawer");

    const focusables = drawer.querySelectorAll<HTMLElement>(
      'button, [href], input, [tabindex]:not([tabindex="-1"])',
    );
    expect(focusables.length).toBeGreaterThan(1);
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    last.focus();
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});
