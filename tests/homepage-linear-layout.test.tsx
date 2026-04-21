// @vitest-environment jsdom

// Stage D §D1/§D2/§D3 — side-by-side fleet chart + live feed, URL-driven
// fullscreen toggle, narrow-viewport collapse.
//
// These tests assert observable layout state on the new <section
// data-cl-bottom-row> wrapper that Agents.tsx introduces:
//   • default (no URL param)     → gridTemplateColumns "1fr 1fr"
//   • URL contains ?chart=full   → gridTemplateColumns "1fr"
//   • toggle button click        → data-cl-chart-fullscreen attribute flips
//   • viewport < 900px           → grid collapses regardless of URL param

import { act, fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// jsdom has no EventSource — FleetHeader (via useSSEStatus) and any other
// consumers call into it when stats land. Shim it out.
class EventSourceShim {
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  readyState = 0;
  close() {}
  addEventListener() {}
  removeEventListener() {}
}
vi.stubGlobal("EventSource", EventSourceShim);

class ResizeObserverShim {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverShim);

vi.mock("../dashboard/src/hooks/useLiveApi", () => ({
  useLiveApi: vi.fn(),
}));
vi.mock("../dashboard/src/hooks/useApi", () => ({
  useApi: vi.fn(),
}));
vi.mock("../dashboard/src/hooks/useSSE", () => ({
  useSSE: vi.fn(),
}));

import { useApi } from "../dashboard/src/hooks/useApi";
import { useLiveApi } from "../dashboard/src/hooks/useLiveApi";
import type { AgentInfo, SessionTimelineResponse, StatsResponse } from "../dashboard/src/lib/types";
import Agents from "../dashboard/src/pages/Agents";

const mockedUseLiveApi = vi.mocked(useLiveApi);
const mockedUseApi = vi.mocked(useApi);

function makeStats(): StatsResponse {
  return {
    total: 10,
    allowed: 10,
    approved: 0,
    blocked: 0,
    timedOut: 0,
    pending: 0,
    riskBreakdown: { low: 10, medium: 0, high: 0, critical: 0 },
    avgRiskScore: 20,
    peakRiskScore: 30,
    activeAgents: 1,
    activeSessions: 1,
    riskPosture: "calm",
    historicDailyMax: 10,
    yesterdayTotal: 5,
    weekAverage: 3,
    llmHealth: { recentAttempts: 0, recentFailures: 0, status: "ok" },
  };
}

function makeAgent(): AgentInfo {
  return {
    id: "alpha",
    name: "alpha",
    status: "active",
    todayToolCalls: 3,
    avgRiskScore: 20,
    peakRiskScore: 30,
    lastActiveTimestamp: "2026-04-20T12:00:00Z",
    mode: "interactive",
    riskPosture: "calm",
    activityBreakdown: {
      exploring: 1,
      changes: 0,
      commands: 2,
      web: 0,
      comms: 0,
      data: 0,
    },
    todayActivityBreakdown: {
      exploring: 1,
      changes: 0,
      commands: 2,
      web: 0,
      comms: 0,
      data: 0,
    },
    needsAttention: false,
    blockedCount: 0,
    riskProfile: { low: 3, medium: 0, high: 0, critical: 0 },
    hourlyActivity: Array.from({ length: 24 }, () => 0),
  };
}

const STABLE_STATS = makeStats();
const STABLE_AGENTS = [makeAgent()];

function wireLiveApi() {
  mockedUseLiveApi.mockImplementation((path: string) => {
    if (path.startsWith("api/stats")) {
      return {
        data: STABLE_STATS,
        loading: false,
        error: null,
        refetch: STABLE_REFETCH,
      };
    }
    if (path.startsWith("api/agents")) {
      return {
        data: STABLE_AGENTS,
        loading: false,
        error: null,
        refetch: STABLE_REFETCH,
      };
    }
    return {
      data: null,
      loading: false,
      error: null,
      refetch: STABLE_REFETCH,
    };
  });
}

// The FleetChart consumes `useApi` directly (session-timeline) and so does the
// LiveFeed (recent entries). Wire both so the chart doesn't hit its empty-state
// branch (which hides the fullscreen toggle button).
//
// We deliberately build the response objects ONCE at module load and return
// the same references on every mock call. Returning fresh objects on each
// render would thrash `useEffect(() => setLiveSessions(apiData.sessions),
// [apiData])` and deadlock the test with an infinite render loop.
const TIMELINE_RESPONSE: SessionTimelineResponse = {
  agents: ["alpha"],
  sessions: [
    {
      sessionKey: "agent:alpha:main:s1",
      agentId: "alpha",
      startTime: "2026-04-20T11:30:00.000Z",
      endTime: "2026-04-20T11:45:00.000Z",
      segments: [
        {
          category: "exploring",
          startTime: "2026-04-20T11:30:00.000Z",
          endTime: "2026-04-20T11:45:00.000Z",
          actionCount: 3,
        },
      ],
      actionCount: 3,
      avgRisk: 10,
      peakRisk: 20,
      blockedCount: 0,
      isActive: false,
    },
  ],
  startTime: "2026-04-20T11:00:00.000Z",
  endTime: "2026-04-20T12:00:00.000Z",
  totalActions: 3,
};
const EMPTY_ENTRIES: never[] = [];
const STABLE_REFETCH = vi.fn();

function wireApi() {
  mockedUseApi.mockImplementation((path: string) => {
    if (path.startsWith("api/session-timeline")) {
      return {
        data: TIMELINE_RESPONSE,
        loading: false,
        error: null,
        refetch: STABLE_REFETCH,
      };
    }
    return {
      data: EMPTY_ENTRIES,
      loading: false,
      error: null,
      refetch: STABLE_REFETCH,
    };
  });
}

function stubViewportWidth(px: number) {
  // matchMedia is the spec-sanctioned signal. mock returning matches=true
  // when the query predicts px satisfies it.
  const mql = (query: string): MediaQueryList => {
    const match = /max-width:\s*(\d+)px/.exec(query);
    const max = match ? Number(match[1]) : Number.POSITIVE_INFINITY;
    return {
      matches: px <= max,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    } as MediaQueryList;
  };
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: mql,
  });
  // ResizeObserver-backed width signals fall back to bounding-rect width.
  Element.prototype.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: px,
      bottom: 600,
      width: px,
      height: 600,
      toJSON: () => ({}),
    }) as DOMRect;
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Agents />
    </MemoryRouter>,
  );
}

const NOW_ISO = "2026-04-20T12:00:00.000Z";

beforeEach(() => {
  // Pin Date.now() just after the fake session data so FleetChart's
  // axis-tick loop stays bounded (otherwise buildAxisTicks iterates from
  // 2026 → real-time-now for 12h tick intervals and blows the heap).
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW_ISO));
  wireLiveApi();
  wireApi();
  stubViewportWidth(1440);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("Agents homepage — bottom-row grid (§D1)", () => {
  it("wraps FleetChart + LiveFeed in a <section data-cl-bottom-row> grid", () => {
    const { container } = renderAt("/");
    const row = container.querySelector("[data-cl-bottom-row]");
    expect(row).not.toBeNull();
    expect((row as HTMLElement).style.display).toBe("grid");
    // Both anchors live inside the row.
    expect(row?.querySelector("[data-cl-fleet-chart-anchor]")).not.toBeNull();
    expect(row?.querySelector("[data-cl-live-feed-anchor]")).not.toBeNull();
  });

  it("default layout (no ?chart URL param) is two equal columns", () => {
    const { container } = renderAt("/");
    const row = container.querySelector<HTMLElement>("[data-cl-bottom-row]");
    expect(row).not.toBeNull();
    expect(row?.style.gridTemplateColumns).toBe("1fr 1fr");
    expect(row?.getAttribute("data-cl-chart-fullscreen")).toBeNull();
  });

  it("collapses to a single column when ?chart=full is in the URL (§D2)", () => {
    const { container } = renderAt("/?chart=full");
    const row = container.querySelector<HTMLElement>("[data-cl-bottom-row]");
    expect(row).not.toBeNull();
    expect(row?.style.gridTemplateColumns).toBe("1fr");
    expect(row?.getAttribute("data-cl-chart-fullscreen")).toBe("true");
  });
});

describe("Agents homepage — fullscreen toggle (§D3)", () => {
  it("renders a fullscreen toggle button in the FleetChart header", () => {
    const { container } = renderAt("/");
    const btn = container.querySelector("[data-cl-chart-fullscreen-toggle]");
    expect(btn).not.toBeNull();
    // Must live inside the fleet chart, not floating in the bottom-row container.
    expect(container.querySelector("[data-cl-fleet-chart-anchor]")?.contains(btn as Node)).toBe(
      true,
    );
    expect(btn?.getAttribute("aria-label")).toMatch(/fullscreen|expand/i);
  });

  it("click flips data-cl-chart-fullscreen on the bottom-row and toggles gridTemplateColumns", () => {
    const { container } = renderAt("/");
    const btn = container.querySelector(
      "[data-cl-chart-fullscreen-toggle]",
    ) as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    if (!btn) return;

    // Pre-click state — two columns.
    let row = container.querySelector<HTMLElement>("[data-cl-bottom-row]");
    expect(row?.style.gridTemplateColumns).toBe("1fr 1fr");

    act(() => {
      fireEvent.click(btn);
    });

    // Post-click — fullscreen on.
    row = container.querySelector<HTMLElement>("[data-cl-bottom-row]");
    expect(row?.getAttribute("data-cl-chart-fullscreen")).toBe("true");
    expect(row?.style.gridTemplateColumns).toBe("1fr");

    // Click again — back to side-by-side.
    act(() => {
      fireEvent.click(btn);
    });
    row = container.querySelector<HTMLElement>("[data-cl-bottom-row]");
    expect(row?.getAttribute("data-cl-chart-fullscreen")).toBeNull();
    expect(row?.style.gridTemplateColumns).toBe("1fr 1fr");
  });
});

describe("Agents homepage — narrow-viewport collapse", () => {
  it("forces single-column layout on viewports <900px regardless of URL param", () => {
    // Narrow viewport overrides the URL — the two-column layout has no room.
    stubViewportWidth(640);
    const { container } = renderAt("/");
    const row = container.querySelector<HTMLElement>("[data-cl-bottom-row]");
    expect(row).not.toBeNull();
    expect(row?.style.gridTemplateColumns).toBe("1fr");
  });

  it("keeps narrow viewports single-column even when ?chart=full is set", () => {
    stubViewportWidth(480);
    const { container } = renderAt("/?chart=full");
    const row = container.querySelector<HTMLElement>("[data-cl-bottom-row]");
    expect(row?.style.gridTemplateColumns).toBe("1fr");
  });
});
