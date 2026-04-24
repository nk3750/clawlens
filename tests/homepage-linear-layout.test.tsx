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
import type { AgentInfo, FleetActivityResponse, StatsResponse } from "../dashboard/src/lib/types";
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
      git: 0,
      scripts: 2,
      web: 0,
      comms: 0,
    },
    todayActivityBreakdown: {
      exploring: 1,
      changes: 0,
      git: 0,
      scripts: 2,
      web: 0,
      comms: 0,
    },
    needsAttention: false,
    blockedCount: 0,
    riskProfile: { low: 3, medium: 0, high: 0, critical: 0 },
    todayRiskMix: { low: 3, medium: 0, high: 0, critical: 0 },
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

// FleetActivityChart consumes `useApi` directly (fleet-activity endpoint).
// LiveFeed consumes it too for the recent-entries list. Wire both so the chart
// doesn't land on its empty-state branch (which would hide the fullscreen toggle
// button).
//
// We build the response objects ONCE at module load and return the same
// references on every mock call. Returning fresh objects on each render would
// thrash `useEffect(() => setLiveEntries(data.entries), [data])` and deadlock
// the test with an infinite render loop.
const FLEET_ACTIVITY_RESPONSE: FleetActivityResponse = {
  entries: [
    {
      timestamp: "2026-04-20T11:30:00.000Z",
      toolName: "read",
      toolCallId: "tc-1",
      params: {},
      effectiveDecision: "allow",
      decision: "allow",
      category: "exploring",
      sessionKey: "agent:alpha:main:s1",
      agentId: "alpha",
    },
    {
      timestamp: "2026-04-20T11:45:00.000Z",
      toolName: "exec",
      toolCallId: "tc-2",
      params: {},
      effectiveDecision: "allow",
      decision: "allow",
      category: "scripts",
      sessionKey: "agent:alpha:main:s1",
      agentId: "alpha",
    },
  ],
  startTime: "2026-04-20T11:00:00.000Z",
  endTime: "2026-04-20T12:00:00.000Z",
  totalActions: 2,
  truncated: false,
};
const EMPTY_ENTRIES: never[] = [];
const STABLE_REFETCH = vi.fn();

function wireApi() {
  mockedUseApi.mockImplementation((path: string) => {
    if (path.startsWith("api/fleet-activity")) {
      return {
        data: FLEET_ACTIVITY_RESPONSE,
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

describe("Agents homepage — bottom-row grid (homepage-bottom-row-spec §8)", () => {
  it("wraps the fleet chart in a full-width data-cl-chart-row and the LiveFeed + FleetRiskTile in a data-cl-insights-row grid", () => {
    const { container } = renderAt("/");
    const chartRow = container.querySelector("[data-cl-chart-row]");
    const insightsRow = container.querySelector("[data-cl-insights-row]");
    expect(chartRow).not.toBeNull();
    expect(insightsRow).not.toBeNull();
    expect((insightsRow as HTMLElement).style.display).toBe("grid");
    // Chart anchor sits in row 1; LiveFeed + FleetRiskTile in row 2.
    expect(chartRow?.querySelector("[data-cl-fleet-chart-anchor]")).not.toBeNull();
    expect(insightsRow?.querySelector("[data-cl-live-feed-anchor]")).not.toBeNull();
    expect(insightsRow?.querySelector("[data-cl-fleet-risk-tile-anchor]")).not.toBeNull();
  });

  it("default layout (no ?chart URL param) is a 2fr/1fr split on the insights row", () => {
    const { container } = renderAt("/");
    const row = container.querySelector<HTMLElement>("[data-cl-insights-row]");
    expect(row).not.toBeNull();
    expect(row?.style.gridTemplateColumns).toBe("2fr 1fr");
    expect(row?.getAttribute("data-cl-chart-fullscreen")).toBeNull();
  });

  it("sets minWidth: 0 on BOTH insights-row cell anchors so 2fr/1fr can shrink below min-content", () => {
    // Without minWidth: 0 on the cell child, Grid's auto floor is min-content
    // and the LiveFeed's intrinsic width blows out the 2fr/1fr split.
    const { container } = renderAt("/");
    const feed = container.querySelector<HTMLElement>("[data-cl-live-feed-anchor]");
    const tile = container.querySelector<HTMLElement>("[data-cl-fleet-risk-tile-anchor]");
    expect(feed).not.toBeNull();
    expect(tile).not.toBeNull();
    expect(feed?.style.minWidth).toBe("0px");
    expect(tile?.style.minWidth).toBe("0px");
  });

  it("collapses the insights row to a single column when ?chart=full is in the URL (§D2)", () => {
    const { container } = renderAt("/?chart=full");
    const row = container.querySelector<HTMLElement>("[data-cl-insights-row]");
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

  it("click flips data-cl-chart-fullscreen on the insights row and toggles gridTemplateColumns", () => {
    // Re-query the button each time — opening/closing the modal portals
    // the chart in/out of document.body, which remounts the button.
    const { container } = renderAt("/");
    const queryBtn = () =>
      document.body.querySelector<HTMLButtonElement>("[data-cl-chart-fullscreen-toggle]");
    const queryRow = () => container.querySelector<HTMLElement>("[data-cl-insights-row]");

    // Pre-click state — two columns.
    expect(queryRow()?.style.gridTemplateColumns).toBe("2fr 1fr");

    const openBtn = queryBtn();
    expect(openBtn).not.toBeNull();
    if (!openBtn) return;
    act(() => {
      fireEvent.click(openBtn);
    });

    // Post-click — fullscreen on.
    expect(queryRow()?.getAttribute("data-cl-chart-fullscreen")).toBe("true");
    expect(queryRow()?.style.gridTemplateColumns).toBe("1fr");

    // Click again — back to side-by-side. Fresh button reference from the
    // portaled chart.
    const closeBtn = queryBtn();
    expect(closeBtn).not.toBeNull();
    if (!closeBtn) return;
    act(() => {
      fireEvent.click(closeBtn);
    });
    expect(queryRow()?.getAttribute("data-cl-chart-fullscreen")).toBeNull();
    expect(queryRow()?.style.gridTemplateColumns).toBe("2fr 1fr");
  });
});

describe("Agents homepage — narrow-viewport collapse (911px breakpoint)", () => {
  it("forces single-column layout on viewports <= 911px regardless of URL param", () => {
    stubViewportWidth(640);
    const { container } = renderAt("/");
    const row = container.querySelector<HTMLElement>("[data-cl-insights-row]");
    expect(row).not.toBeNull();
    expect(row?.style.gridTemplateColumns).toBe("1fr");
  });

  it("still stacks at exactly 911px (boundary is inclusive)", () => {
    stubViewportWidth(911);
    const { container } = renderAt("/");
    const row = container.querySelector<HTMLElement>("[data-cl-insights-row]");
    expect(row?.style.gridTemplateColumns).toBe("1fr");
  });

  it("shows the weighted split at exactly 912px (boundary is exclusive)", () => {
    stubViewportWidth(912);
    const { container } = renderAt("/");
    const row = container.querySelector<HTMLElement>("[data-cl-insights-row]");
    expect(row?.style.gridTemplateColumns).toBe("2fr 1fr");
  });

  it("keeps narrow viewports single-column even when ?chart=full is set", () => {
    stubViewportWidth(480);
    const { container } = renderAt("/?chart=full");
    const row = container.querySelector<HTMLElement>("[data-cl-insights-row]");
    expect(row?.style.gridTemplateColumns).toBe("1fr");
  });
});

// ── Modal fullscreen overlay (layout-fixes §2) ────────────

describe("Agents homepage — modal fullscreen overlay (layout-fixes §2, portaled)", () => {
  it("portals the chart anchor + backdrop to document.body (NOT inside the app container)", () => {
    // The fix: modal mounts via createPortal(..., document.body) so it
    // escapes the `.page-enter` transformed ancestor that was making
    // `position: fixed` measure from the wrong origin.
    const { container } = renderAt("/?chart=full");
    // Inside the rendered app container: no modal host, no backdrop.
    expect(container.querySelector(".cl-chart-modal-host")).toBeNull();
    expect(container.querySelector(".cl-chart-modal-backdrop")).toBeNull();
    // At document.body level: both present.
    expect(document.body.querySelector(".cl-chart-modal-host")).not.toBeNull();
    expect(document.body.querySelector(".cl-chart-modal-backdrop")).not.toBeNull();
  });

  it("applies .cl-chart-modal-host + dialog aria to the portaled chart anchor when ?chart=full", () => {
    renderAt("/?chart=full");
    const chart = document.body.querySelector<HTMLElement>("[data-cl-fleet-chart-anchor]");
    expect(chart).not.toBeNull();
    expect(chart?.className ?? "").toMatch(/\bcl-chart-modal-host\b/);
    expect(chart?.getAttribute("role")).toBe("dialog");
    expect(chart?.getAttribute("aria-modal")).toBe("true");
    expect(chart?.getAttribute("aria-label")).toMatch(/fullscreen/i);
  });

  it("does NOT apply the modal host class at default (no URL param)", () => {
    const { container } = renderAt("/");
    const chart = container.querySelector<HTMLElement>("[data-cl-fleet-chart-anchor]");
    expect(chart?.className ?? "").not.toMatch(/cl-chart-modal-host/);
    expect(chart?.getAttribute("role")).toBeNull();
  });

  it("does NOT render a backdrop at default (no URL param)", () => {
    renderAt("/");
    expect(document.body.querySelector(".cl-chart-modal-backdrop")).toBeNull();
  });

  it("renders the backdrop while the modal is open", () => {
    renderAt("/?chart=full");
    const backdrop = document.body.querySelector<HTMLElement>(".cl-chart-modal-backdrop");
    expect(backdrop).not.toBeNull();
    expect(backdrop?.getAttribute("aria-hidden")).toBe("true");
  });

  it("backdrop unmounts when the toggle is clicked", () => {
    renderAt("/?chart=full");
    expect(document.body.querySelector(".cl-chart-modal-backdrop")).not.toBeNull();
    const btn = document.body.querySelector<HTMLButtonElement>("[data-cl-chart-fullscreen-toggle]");
    expect(btn).not.toBeNull();
    if (!btn) return;
    act(() => {
      fireEvent.click(btn);
    });
    expect(document.body.querySelector(".cl-chart-modal-backdrop")).toBeNull();
  });

  it("backdrop click dismisses the modal (flips the URL param)", () => {
    renderAt("/?chart=full");
    const backdrop = document.body.querySelector<HTMLElement>(".cl-chart-modal-backdrop");
    expect(backdrop).not.toBeNull();
    if (!backdrop) return;
    act(() => {
      fireEvent.click(backdrop);
    });
    expect(document.body.querySelector(".cl-chart-modal-backdrop")).toBeNull();
    expect(document.body.querySelector(".cl-chart-modal-host")).toBeNull();
  });

  it("backdrop click is guarded — bubbled clicks from inside the modal don't dismiss", () => {
    renderAt("/?chart=full");
    const backdrop = document.body.querySelector<HTMLElement>(".cl-chart-modal-backdrop");
    const chart = document.body.querySelector<HTMLElement>("[data-cl-fleet-chart-anchor]");
    expect(backdrop).not.toBeNull();
    expect(chart).not.toBeNull();
    if (!backdrop || !chart) return;
    // A click whose target is the chart (not the backdrop itself) must
    // NOT close the modal. Guard: e.target === e.currentTarget.
    act(() => {
      fireEvent.click(backdrop, { target: chart });
    });
    expect(document.body.querySelector(".cl-chart-modal-backdrop")).not.toBeNull();
  });

  it("Esc keydown on window dismisses the modal", () => {
    renderAt("/?chart=full");
    expect(document.body.querySelector(".cl-chart-modal-backdrop")).not.toBeNull();
    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(document.body.querySelector(".cl-chart-modal-backdrop")).toBeNull();
  });

  it("Esc keydown is a no-op when the modal is not open", () => {
    const { container } = renderAt("/");
    const row = container.querySelector<HTMLElement>("[data-cl-insights-row]");
    expect(row?.style.gridTemplateColumns).toBe("2fr 1fr");
    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    const after = container.querySelector<HTMLElement>("[data-cl-insights-row]");
    expect(after?.style.gridTemplateColumns).toBe("2fr 1fr");
  });

  it("locks body scroll while modal is open and restores prior overflow when toggled off", () => {
    const prior = "auto";
    document.body.style.overflow = prior;
    renderAt("/?chart=full");
    expect(document.body.style.overflow).toBe("hidden");

    const btn = document.body.querySelector<HTMLButtonElement>("[data-cl-chart-fullscreen-toggle]");
    expect(btn).not.toBeNull();
    if (!btn) return;
    act(() => {
      fireEvent.click(btn);
    });
    expect(document.body.style.overflow).toBe(prior);
    expect(document.body.querySelector(".cl-chart-modal-backdrop")).toBeNull();
  });

  it("restores prior body overflow on unmount while modal still open", () => {
    const prior = "scroll";
    document.body.style.overflow = prior;
    const { unmount } = renderAt("/?chart=full");
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe(prior);
  });

  it("focuses the minimize button on modal open (via autoFocus)", () => {
    // No rAF advance needed — autoFocus on the button fires synchronously
    // when the portaled modal mounts.
    renderAt("/?chart=full");
    const btn = document.body.querySelector<HTMLButtonElement>("[data-cl-chart-fullscreen-toggle]");
    expect(btn).not.toBeNull();
    expect(document.activeElement).toBe(btn);
  });
});

// ── Tight prop wiring (layout-fixes §3) ────────────────────

// ── Range pill group placement (issue #16) ─────────────────

describe("Agents homepage — range pill placement (issue #16)", () => {
  it("renders exactly one 'Time range' radiogroup, inside the fleet-chart anchor", () => {
    const { container } = renderAt("/");
    const radiogroups = container.querySelectorAll('[role="radiogroup"][aria-label="Time range"]');
    expect(radiogroups).toHaveLength(1);
    const chartAnchor = container.querySelector("[data-cl-fleet-chart-anchor]");
    expect(chartAnchor).not.toBeNull();
    expect(chartAnchor?.contains(radiogroups[0])).toBe(true);
  });

  it("does NOT render a range radiogroup inside the fleet-header top strip", () => {
    const { container } = renderAt("/");
    const fleetHeader = container.querySelector("[data-cl-fleet-header]");
    expect(fleetHeader).not.toBeNull();
    expect(fleetHeader?.querySelector('[role="radiogroup"][aria-label="Time range"]')).toBeNull();
  });

  it("clicking a pill in the chart header updates the visually-checked pill", () => {
    const { container } = renderAt("/");
    const pills = [...container.querySelectorAll('[role="radio"]')];
    const oneHour = pills.find((el) => el.textContent?.trim() === "1h");
    expect(oneHour).toBeDefined();
    if (!oneHour) return;
    act(() => {
      fireEvent.click(oneHour);
    });
    const checked = container.querySelector('[role="radio"][aria-checked="true"]');
    expect(checked?.textContent?.trim()).toBe("1h");
  });
});

// The "tight prop" describe block was removed together with the old FleetChart.
// The new FleetActivityChart uses uniform dot radii (4px routine, 5px cluster);
// layout width is no longer encoded into the chart's rendered geometry.
