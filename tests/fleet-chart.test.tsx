// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Provide a ResizeObserver shim for jsdom — FleetChart uses it to react to
// container width changes.
class ResizeObserverShim {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverShim);

// jsdom returns zero for getBoundingClientRect on unlaid-out elements, which
// defeats the strip's self-measurement fallback. Stub a sensible width for
// every element so circles land at readable coordinates in tests. The viewBox
// regression test relies on this stub reporting > 0.
const STUB_STRIP_WIDTH = 900;
Element.prototype.getBoundingClientRect = () =>
  ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: STUB_STRIP_WIDTH,
    bottom: 56,
    width: STUB_STRIP_WIDTH,
    height: 56,
    toJSON: () => ({}),
  }) as DOMRect;

vi.mock("../dashboard/src/hooks/useApi", () => ({
  useApi: vi.fn(),
}));
vi.mock("../dashboard/src/hooks/useSSE", () => ({
  useSSE: vi.fn(),
}));

import FleetChart from "../dashboard/src/components/FleetChart/FleetChart";
import { useApi } from "../dashboard/src/hooks/useApi";
import { useSSE } from "../dashboard/src/hooks/useSSE";
import type {
  AgentInfo,
  SessionTimelineResponse,
  TimelineSession,
} from "../dashboard/src/lib/types";
import { riskColorRaw } from "../dashboard/src/lib/utils";

const mockedUseApi = vi.mocked(useApi);
const mockedUseSSE = vi.mocked(useSSE);

const NOW_ISO = "2026-04-19T12:00:00.000Z";

function makeAgent(partial: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: "alpha",
    name: "alpha",
    status: "active",
    todayToolCalls: 3,
    avgRiskScore: 20,
    peakRiskScore: 30,
    lastActiveTimestamp: NOW_ISO,
    mode: "interactive",
    riskPosture: "calm",
    activityBreakdown: {
      exploring: 0,
      changes: 0,
      commands: 0,
      web: 0,
      comms: 0,
      data: 0,
    },
    todayActivityBreakdown: {
      exploring: 0,
      changes: 0,
      commands: 0,
      web: 0,
      comms: 0,
      data: 0,
    },
    needsAttention: false,
    blockedCount: 0,
    riskProfile: { low: 0, medium: 0, high: 0, critical: 0 },
    hourlyActivity: Array.from({ length: 24 }, () => 0),
    ...partial,
  };
}

function makeSession(partial: Partial<TimelineSession> = {}): TimelineSession {
  return {
    sessionKey: "agent:alpha:main:s1",
    agentId: "alpha",
    startTime: new Date(Date.parse(NOW_ISO) - 30 * 60_000).toISOString(),
    endTime: new Date(Date.parse(NOW_ISO) - 29 * 60_000).toISOString(),
    segments: [
      {
        category: "exploring",
        startTime: new Date(Date.parse(NOW_ISO) - 30 * 60_000).toISOString(),
        endTime: new Date(Date.parse(NOW_ISO) - 29 * 60_000).toISOString(),
        actionCount: 1,
      },
    ],
    actionCount: 2,
    avgRisk: 10,
    peakRisk: 30,
    blockedCount: 0,
    isActive: false,
    ...partial,
  };
}

function response(sessions: TimelineSession[]): SessionTimelineResponse {
  const agents = Array.from(new Set(sessions.map((s) => s.agentId)));
  const actions = sessions.reduce((a, s) => a + s.actionCount, 0);
  return {
    agents,
    sessions,
    startTime: sessions[0]?.startTime ?? new Date(Date.parse(NOW_ISO) - 60 * 60_000).toISOString(),
    endTime: sessions[sessions.length - 1]?.endTime ?? NOW_ISO,
    totalActions: actions,
  };
}

function mockApiReturn(data: SessionTimelineResponse | null) {
  mockedUseApi.mockReturnValue({
    data,
    loading: false,
    error: null,
    refetch: vi.fn(),
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW_ISO));
  mockedUseSSE.mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

function renderChart(
  partial: {
    sessions?: TimelineSession[];
    agents?: AgentInfo[];
    range?: "1h" | "3h" | "6h" | "12h" | "24h" | "7d";
    pending?: ReadonlySet<string>;
  } = {},
) {
  const sessions = partial.sessions ?? [makeSession()];
  const agents = partial.agents ?? [makeAgent()];
  const range = partial.range ?? "3h";
  mockApiReturn(response(sessions));
  return render(
    <MemoryRouter>
      <FleetChart
        isToday
        selectedDate={null}
        range={range}
        agents={agents}
        pendingSessionKeys={partial.pending ?? new Set()}
      />
    </MemoryRouter>,
  );
}

describe("FleetChart — row anatomy", () => {
  it("renders one row per agent with identity + middle + totals", () => {
    const { container } = renderChart({
      agents: [makeAgent({ id: "a1", name: "a1" }), makeAgent({ id: "a2", name: "a2" })],
      sessions: [
        makeSession({ sessionKey: "agent:a1:main:s1", agentId: "a1" }),
        makeSession({ sessionKey: "agent:a2:main:s1", agentId: "a2" }),
      ],
    });
    const rows = container.querySelectorAll("[data-cl-fleet-row]");
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.querySelector("[data-cl-fleet-middle]")).not.toBeNull();
      expect(row.querySelector("[data-cl-fleet-totals]")).not.toBeNull();
    }
  });

  it("renders the agent name in the identity strip", () => {
    renderChart({
      agents: [makeAgent({ id: "a1", name: "alpha" })],
      sessions: [makeSession({ sessionKey: "agent:a1:main:s1", agentId: "a1" })],
    });
    expect(screen.getByText("alpha")).toBeInTheDocument();
  });

  it("renders the totals strip with the summed action count", () => {
    const { container } = renderChart({
      agents: [makeAgent({ id: "a1", name: "a1", todayToolCalls: 0 })],
      sessions: [
        makeSession({
          sessionKey: "agent:a1:main:s1",
          agentId: "a1",
          actionCount: 4,
        }),
        makeSession({
          sessionKey: "agent:a1:main:s2",
          agentId: "a1",
          actionCount: 3,
        }),
      ],
    });
    const totals = container.querySelector("[data-cl-fleet-totals]");
    expect(totals?.textContent).toMatch(/7\s*actions/);
  });
});

describe("FleetChart — peak-risk color consistency (§7)", () => {
  it("uses peakRisk (not avgRisk) for dot fill color", () => {
    const { container } = renderChart({
      agents: [makeAgent({ id: "a1", name: "a1" })],
      sessions: [
        makeSession({
          sessionKey: "agent:a1:main:mix",
          agentId: "a1",
          avgRisk: 20, // would render as LOW if used
          peakRisk: 80, // CRITICAL
        }),
      ],
    });
    const dot = container.querySelector("[data-cl-fleet-dot]");
    expect(dot?.getAttribute("data-cl-risk-tier")).toBe("critical");
    const circle = dot?.querySelector("circle");
    expect(circle?.getAttribute("fill")).toBe(riskColorRaw("critical"));
  });
});

describe("FleetChart — cluster collapse at 8px threshold (§2e)", () => {
  it("merges two dots whose cx falls within 8px into a single cluster marker", () => {
    // Same agent, two sessions 1s apart — at 3h/1000px strip that's <1px apart.
    const base = Date.parse(NOW_ISO) - 30 * 60_000;
    const { container } = renderChart({
      agents: [makeAgent({ id: "a1", name: "a1" })],
      sessions: [
        makeSession({
          sessionKey: "agent:a1:main:s1",
          agentId: "a1",
          startTime: new Date(base).toISOString(),
          endTime: new Date(base + 500).toISOString(),
        }),
        makeSession({
          sessionKey: "agent:a1:main:s2",
          agentId: "a1",
          startTime: new Date(base + 1000).toISOString(),
          endTime: new Date(base + 1500).toISOString(),
        }),
      ],
    });
    const dots = container.querySelectorAll("[data-cl-fleet-dot]");
    expect(dots).toHaveLength(1);
    const dot = dots[0];
    expect(dot.getAttribute("data-cl-cluster")).toBe("true");
    expect(dot.querySelector("[data-cl-fleet-cluster-count]")?.textContent).toBe("2");
  });

  it("keeps dots separate when sessions are far apart", () => {
    const base = Date.parse(NOW_ISO);
    const { container } = renderChart({
      agents: [makeAgent({ id: "a1", name: "a1" })],
      sessions: [
        makeSession({
          sessionKey: "agent:a1:main:s1",
          agentId: "a1",
          startTime: new Date(base - 2 * 3_600_000).toISOString(),
          endTime: new Date(base - 2 * 3_600_000 + 5000).toISOString(),
        }),
        makeSession({
          sessionKey: "agent:a1:main:s2",
          agentId: "a1",
          startTime: new Date(base - 30 * 60_000).toISOString(),
          endTime: new Date(base - 30 * 60_000 + 5000).toISOString(),
        }),
      ],
    });
    const dots = container.querySelectorAll("[data-cl-fleet-dot]");
    expect(dots).toHaveLength(2);
    for (const d of dots) {
      expect(d.getAttribute("data-cl-cluster")).toBe("false");
    }
  });
});

describe("FleetChart — day-grid 7-cell shape (range=7d)", () => {
  it("renders 7 cells per agent row when range is 7d", () => {
    const { container } = renderChart({
      range: "7d",
      agents: [makeAgent({ id: "a1", name: "a1" })],
      sessions: [makeSession({ sessionKey: "agent:a1:main:s1", agentId: "a1" })],
    });
    const cells = container.querySelectorAll("[data-cl-fleet-day-grid] [data-cl-day-cell]");
    expect(cells).toHaveLength(7);
  });

  it("renders day-of-week column headers above the grid", () => {
    const { container } = renderChart({
      range: "7d",
      agents: [makeAgent({ id: "a1", name: "a1" })],
      sessions: [makeSession({ sessionKey: "agent:a1:main:s1", agentId: "a1" })],
    });
    const headers = container.querySelectorAll("[data-cl-fleet-day-header]");
    expect(headers).toHaveLength(7);
  });

  it("today cell gets the accent border", () => {
    const { container } = renderChart({
      range: "7d",
      agents: [makeAgent({ id: "a1", name: "a1" })],
      sessions: [makeSession({ sessionKey: "agent:a1:main:s1", agentId: "a1" })],
    });
    const today = container.querySelector('[data-cl-day-cell][data-cl-day-today="true"]');
    expect(today).not.toBeNull();
    expect(today?.querySelector("[data-cl-day-today-border]")).not.toBeNull();
  });
});

describe("FleetChart — idle agent visibility (§4d)", () => {
  it("keeps agents with zero sessions in the row list", () => {
    const { container } = renderChart({
      agents: [
        makeAgent({ id: "a1", name: "a1", todayToolCalls: 5 }),
        makeAgent({
          id: "idle",
          name: "idle",
          status: "idle",
          todayToolCalls: 0,
          lastActiveTimestamp: null,
        }),
      ],
      sessions: [makeSession({ sessionKey: "agent:a1:main:s1", agentId: "a1" })],
    });
    const rows = container.querySelectorAll("[data-cl-fleet-row]");
    expect(rows).toHaveLength(2);
    const ids = [...rows].map((r) => r.getAttribute("data-cl-agent"));
    expect(ids).toContain("idle");
  });
});

describe("FleetChart — tooltip clears on range change (§7)", () => {
  it("dismounts the tooltip when range changes", () => {
    const { rerender, container } = renderChart({
      range: "3h",
    });
    // Drive React's synthetic onMouseEnter via fireEvent so the tooltip state
    // is populated the same way a user hover would.
    const dot = container.querySelector("[data-cl-fleet-dot]") as SVGGElement | null;
    expect(dot).not.toBeNull();
    if (!dot) return;
    act(() => {
      fireEvent.mouseEnter(dot, { clientX: 100, clientY: 20 });
    });
    expect(container.querySelector("[data-cl-fleet-tooltip]")).not.toBeNull();

    // Range pill flip — tooltip should clear.
    mockApiReturn(response([makeSession()]));
    rerender(
      <MemoryRouter>
        <FleetChart
          isToday
          selectedDate={null}
          range="1h"
          agents={[makeAgent()]}
          pendingSessionKeys={new Set()}
        />
      </MemoryRouter>,
    );
    expect(container.querySelector("[data-cl-fleet-tooltip]")).toBeNull();
  });
});

describe("FleetChart — pending crowns", () => {
  it("renders a pending ring when the session's raw key is in the pending set", () => {
    const { container } = renderChart({
      agents: [makeAgent({ id: "a1", name: "a1" })],
      sessions: [makeSession({ sessionKey: "agent:a1:main:pending", agentId: "a1" })],
      pending: new Set(["agent:a1:main:pending"]),
    });
    expect(container.querySelector("[data-cl-fleet-pending]")).not.toBeNull();
  });

  it("renders a pending ring when the pending set carries the root of a split #N key", () => {
    const { container } = renderChart({
      agents: [makeAgent({ id: "a1", name: "a1" })],
      sessions: [makeSession({ sessionKey: "agent:a1:main:work#2", agentId: "a1" })],
      pending: new Set(["agent:a1:main:work"]),
    });
    expect(container.querySelector("[data-cl-fleet-pending]")).not.toBeNull();
  });
});

describe("FleetChart — empty state", () => {
  it("renders the empty copy when nothing is in the window", () => {
    mockApiReturn(response([]));
    render(
      <MemoryRouter>
        <FleetChart
          isToday
          selectedDate={null}
          range="6h"
          agents={[]}
          pendingSessionKeys={new Set()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText(/No agent activity in the last 6 hours/i)).toBeInTheDocument();
  });
});

// ── Regression: SVG aspect ratio lock (bug #1) ──────────────

describe("FleetChart — SVG aspect-ratio regression (bug #1)", () => {
  it("strip SVG does NOT use preserveAspectRatio=none", () => {
    const { container } = renderChart({
      agents: [makeAgent({ id: "a1", name: "a1" })],
      sessions: [makeSession({ sessionKey: "agent:a1:main:s1", agentId: "a1" })],
    });
    const strip = container.querySelector("[data-cl-fleet-strip]");
    expect(strip).not.toBeNull();
    expect(strip?.getAttribute("preserveAspectRatio")).not.toBe("none");
  });

  it("day-grid SVG does NOT use preserveAspectRatio=none", () => {
    const { container } = renderChart({
      range: "7d",
      agents: [makeAgent({ id: "a1", name: "a1" })],
      sessions: [makeSession({ sessionKey: "agent:a1:main:s1", agentId: "a1" })],
    });
    const grid = container.querySelector("[data-cl-fleet-day-grid]");
    expect(grid).not.toBeNull();
    expect(grid?.getAttribute("preserveAspectRatio")).not.toBe("none");
  });

  it("strip viewBox width equals the SVG's rendered pixel width", () => {
    const { container } = renderChart({
      agents: [makeAgent({ id: "a1", name: "a1" })],
      sessions: [makeSession({ sessionKey: "agent:a1:main:s1", agentId: "a1" })],
    });
    const strip = container.querySelector("[data-cl-fleet-strip]") as SVGSVGElement | null;
    expect(strip).not.toBeNull();
    if (!strip) return;
    const viewBox = strip.getAttribute("viewBox") ?? "";
    const [, , vbW] = viewBox.split(" ").map(Number);
    const widthAttr = Number(strip.getAttribute("width"));
    expect(vbW).toBeGreaterThan(0);
    // viewBox width must match rendered pixel width so circles stay round.
    expect(vbW).toBe(widthAttr);
  });
});

// ── Regression: channel dedup + filter (bug #2) ────────────

describe("FleetChart — channel chip filter (bug #2)", () => {
  it("renders zero channel chips when all sessions are on main (even across many #N splits)", async () => {
    const { container } = renderChart({
      agents: [makeAgent({ id: "a1", name: "a1" })],
      sessions: [
        makeSession({ sessionKey: "agent:a1:main", agentId: "a1" }),
        makeSession({ sessionKey: "agent:a1:main#2", agentId: "a1" }),
        makeSession({ sessionKey: "agent:a1:main#3", agentId: "a1" }),
        makeSession({ sessionKey: "agent:a1:main#4", agentId: "a1" }),
        makeSession({ sessionKey: "agent:a1:main#5", agentId: "a1" }),
      ],
    });
    const chips = container.querySelectorAll("[data-cl-fleet-channel-chip]");
    expect(chips).toHaveLength(0);
  });

  it("renders one chip per distinct channel id (cron + tg), not one per session", () => {
    const { container } = renderChart({
      agents: [makeAgent({ id: "a1", name: "a1" })],
      sessions: [
        makeSession({ sessionKey: "agent:a1:cron:job", agentId: "a1" }),
        makeSession({ sessionKey: "agent:a1:cron:job#2", agentId: "a1" }),
        makeSession({ sessionKey: "agent:a1:cron:job#3", agentId: "a1" }),
        makeSession({ sessionKey: "agent:a1:telegram:chat", agentId: "a1" }),
        makeSession({ sessionKey: "agent:a1:telegram:chat#2", agentId: "a1" }),
      ],
    });
    const chipIds = [...container.querySelectorAll("[data-cl-fleet-channel-chip]")].map((el) =>
      el.getAttribute("data-cl-fleet-channel-chip"),
    );
    expect(chipIds).toEqual(["cron", "telegram"]);
  });
});

// ── Regression: cluster-click popover (bug #3) ─────────────

describe("FleetChart — cluster-click popover (bug #3)", () => {
  it("opens a popover (not a navigation) when a cluster marker is clicked", () => {
    const base = Date.parse(NOW_ISO) - 30 * 60_000;
    const { container } = renderChart({
      agents: [makeAgent({ id: "a1", name: "a1" })],
      sessions: [
        makeSession({
          sessionKey: "agent:a1:main:s1",
          agentId: "a1",
          startTime: new Date(base).toISOString(),
          endTime: new Date(base + 500).toISOString(),
        }),
        makeSession({
          sessionKey: "agent:a1:main:s2",
          agentId: "a1",
          startTime: new Date(base + 1000).toISOString(),
          endTime: new Date(base + 1500).toISOString(),
        }),
      ],
    });
    const cluster = container.querySelector(
      '[data-cl-fleet-dot][data-cl-cluster="true"]',
    ) as SVGGElement | null;
    expect(cluster).not.toBeNull();
    if (!cluster) return;
    act(() => {
      fireEvent.click(cluster, { clientX: 400, clientY: 20 });
    });
    expect(container.querySelector("[data-cl-fleet-cluster-popover]")).not.toBeNull();
    // Popover must list every session in the cluster.
    const rows = container.querySelectorAll("[data-cl-fleet-cluster-popover-row]");
    expect(rows).toHaveLength(2);
  });

  it("closes the popover on Escape", () => {
    const base = Date.parse(NOW_ISO) - 30 * 60_000;
    const { container } = renderChart({
      agents: [makeAgent({ id: "a1", name: "a1" })],
      sessions: [
        makeSession({
          sessionKey: "agent:a1:main:s1",
          agentId: "a1",
          startTime: new Date(base).toISOString(),
          endTime: new Date(base + 500).toISOString(),
        }),
        makeSession({
          sessionKey: "agent:a1:main:s2",
          agentId: "a1",
          startTime: new Date(base + 1000).toISOString(),
          endTime: new Date(base + 1500).toISOString(),
        }),
      ],
    });
    const cluster = container.querySelector(
      '[data-cl-fleet-dot][data-cl-cluster="true"]',
    ) as SVGGElement | null;
    if (!cluster) throw new Error("cluster marker missing");
    act(() => {
      fireEvent.click(cluster, { clientX: 400, clientY: 20 });
    });
    expect(container.querySelector("[data-cl-fleet-cluster-popover]")).not.toBeNull();
    // Let the deferred document-level listener attach.
    act(() => {
      vi.advanceTimersByTime(10);
    });
    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(container.querySelector("[data-cl-fleet-cluster-popover]")).toBeNull();
  });
});

// ── Regression: row-hover dim (bug #4) ─────────────────────

describe("FleetChart — row-hover dim (bug #4)", () => {
  it("dims sibling rows to 0.3 opacity when hovering a row container", () => {
    const { container } = renderChart({
      agents: [
        makeAgent({ id: "a1", name: "a1", todayToolCalls: 3 }),
        makeAgent({ id: "a2", name: "a2", todayToolCalls: 3 }),
      ],
      sessions: [
        makeSession({ sessionKey: "agent:a1:main:s", agentId: "a1" }),
        makeSession({ sessionKey: "agent:a2:main:s", agentId: "a2" }),
      ],
    });
    const row1 = container.querySelector(
      '[data-cl-fleet-row][data-cl-agent="a1"]',
    ) as HTMLElement | null;
    const row2 = container.querySelector(
      '[data-cl-fleet-row][data-cl-agent="a2"]',
    ) as HTMLElement | null;
    expect(row1).not.toBeNull();
    expect(row2).not.toBeNull();
    if (!row1 || !row2) return;

    act(() => {
      fireEvent.mouseEnter(row1);
    });
    expect(row1.style.opacity).toBe("1");
    expect(row2.style.opacity).toBe("0.3");

    act(() => {
      fireEvent.mouseLeave(row1);
    });
    expect(row1.style.opacity).toBe("1");
    expect(row2.style.opacity).toBe("1");
  });

  it("marks [data-cl-fleet-body] with data-cl-fleet-hovered={agentId} on hover", () => {
    const { container } = renderChart({
      agents: [
        makeAgent({ id: "a1", name: "a1", todayToolCalls: 3 }),
        makeAgent({ id: "a2", name: "a2", todayToolCalls: 3 }),
      ],
      sessions: [
        makeSession({ sessionKey: "agent:a1:main:s", agentId: "a1" }),
        makeSession({ sessionKey: "agent:a2:main:s", agentId: "a2" }),
      ],
    });
    const body = container.querySelector("[data-cl-fleet-body]") as HTMLElement;
    const row1 = container.querySelector('[data-cl-fleet-row][data-cl-agent="a1"]') as HTMLElement;
    expect(body.getAttribute("data-cl-fleet-hovered")).toBeNull();
    act(() => {
      fireEvent.mouseEnter(row1);
    });
    expect(body.getAttribute("data-cl-fleet-hovered")).toBe("a1");
    act(() => {
      fireEvent.mouseLeave(row1);
    });
    expect(body.getAttribute("data-cl-fleet-hovered")).toBeNull();
  });
});

// ── Regression: predict-next-run accepts sub-minute cadence ─

describe("predictNextRun — sub-minute cadence (bug-adjacent)", () => {
  it("returns a future prediction for a 30-second cadence cron series", async () => {
    const { predictNextRun } = await import("../dashboard/src/components/FleetChart/utils");
    const now = Date.parse(NOW_ISO);
    // 6 cron starts at 30s intervals ending 30s before NOW.
    const sessions = Array.from({ length: 6 }, (_, i) => ({
      sessionKey: `agent:a1:cron:job#${i + 1}`,
      agentId: "a1",
      startTime: new Date(now - (6 - i) * 30_000).toISOString(),
      endTime: new Date(now - (6 - i) * 30_000 + 200).toISOString(),
      segments: [],
      actionCount: 1,
      avgRisk: 0,
      peakRisk: 0,
      blockedCount: 0,
      isActive: false,
    }));
    const next = predictNextRun("a1", sessions as never, now);
    expect(next).not.toBeNull();
    if (next !== null) expect(next).toBeGreaterThan(now);
  });
});
