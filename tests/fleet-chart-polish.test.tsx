// @vitest-environment jsdom

// Tests for the fleet-chart polish pass:
//   §1 — dedupe schedule-implied channel chips
//   §2 — NOW label guard on the axis
//   §3 — dormancy hide
//   §4 — unified top-N expander (+ needs-attention always inline, mobile cap)

import { act, fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class ResizeObserverShim {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverShim);

// Stub a desktop-width bounding box so the strip + viewport-detection logic
// land in their wide-screen branches by default. Individual tests override
// for mobile cases.
const DESKTOP_STRIP_WIDTH = 1200;
const desktopRect = (): DOMRect =>
  ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: DESKTOP_STRIP_WIDTH,
    bottom: 56,
    width: DESKTOP_STRIP_WIDTH,
    height: 56,
    toJSON: () => ({}),
  }) as DOMRect;
Element.prototype.getBoundingClientRect = desktopRect;

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

const mockedUseApi = vi.mocked(useApi);
const mockedUseSSE = vi.mocked(useSSE);

// NOW falls right on top of an axis tick boundary (12:00:00 = 12pm sharp) so
// the NOW-guard test has a tick to suppress. Many other tests reuse this.
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

const HOUR_MS = 3_600_000;
const RANGE_SPAN_MS: Record<string, number> = {
  "1h": HOUR_MS,
  "3h": 3 * HOUR_MS,
  "6h": 6 * HOUR_MS,
  "12h": 12 * HOUR_MS,
  "24h": 24 * HOUR_MS,
  "7d": 7 * 24 * HOUR_MS,
};

function response(
  sessions: TimelineSession[],
  range: keyof typeof RANGE_SPAN_MS = "3h",
): SessionTimelineResponse {
  const agents = Array.from(new Set(sessions.map((s) => s.agentId)));
  const actions = sessions.reduce((a, s) => a + s.actionCount, 0);
  // Span the full range so the axis renders the expected tick density. The
  // backend's session-timeline response covers the full window, even when
  // the only session inside it is recent — mirror that here.
  const startTime = new Date(Date.parse(NOW_ISO) - RANGE_SPAN_MS[range]).toISOString();
  return {
    agents,
    sessions,
    startTime,
    endTime: NOW_ISO,
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
  Element.prototype.getBoundingClientRect = desktopRect;
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
  mockApiReturn(response(sessions, range));
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

// ── §1 — dedupe schedule-implied channel chips ────────────

describe("FleetChart §1 — dedupe schedule channel chips", () => {
  it("does not render a cron channel chip when scheduleLabel is present (cron implied)", () => {
    const { container } = renderChart({
      agents: [
        makeAgent({
          id: "sched",
          name: "sched",
          mode: "scheduled",
          schedule: "0 */6 * * *",
        }),
      ],
      sessions: [
        makeSession({
          sessionKey: "agent:sched:cron:job",
          agentId: "sched",
        }),
        makeSession({
          sessionKey: "agent:sched:cron:job#2",
          agentId: "sched",
        }),
      ],
    });
    // Schedule chip exists (the ⏰ every Nh badge).
    expect(container.querySelector("[data-cl-fleet-schedule-chip]")).not.toBeNull();
    // Cron channel chip does NOT — it would be a redundant ⏰.
    expect(container.querySelector('[data-cl-fleet-channel-chip="cron"]')).toBeNull();
  });

  it("does not render a heartbeat channel chip when scheduleLabel is present", () => {
    const { container } = renderChart({
      agents: [
        makeAgent({
          id: "beat",
          name: "beat",
          mode: "scheduled",
          schedule: "*/5 * * * *",
        }),
      ],
      sessions: [
        // The schedule label comes from the cron-derived cadence; mix in
        // heartbeat sessions to prove the kind-based filter (not just an
        // id="cron" check) excludes them.
        makeSession({
          sessionKey: "agent:beat:cron:job",
          agentId: "beat",
        }),
        makeSession({
          sessionKey: "agent:beat:cron:job#2",
          agentId: "beat",
        }),
        makeSession({
          sessionKey: "agent:beat:heartbeat:tick",
          agentId: "beat",
        }),
      ],
    });
    expect(container.querySelector("[data-cl-fleet-schedule-chip]")).not.toBeNull();
    expect(container.querySelector('[data-cl-fleet-channel-chip="cron"]')).toBeNull();
    expect(container.querySelector('[data-cl-fleet-channel-chip="heartbeat"]')).toBeNull();
  });

  it("still renders a non-schedule channel chip (telegram) alongside the schedule chip", () => {
    const { container } = renderChart({
      agents: [
        makeAgent({
          id: "mix",
          name: "mix",
          mode: "scheduled",
          schedule: "0 */3 * * *",
        }),
      ],
      sessions: [
        makeSession({ sessionKey: "agent:mix:cron:job", agentId: "mix" }),
        makeSession({ sessionKey: "agent:mix:cron:job#2", agentId: "mix" }),
        makeSession({
          sessionKey: "agent:mix:telegram:dm",
          agentId: "mix",
        }),
      ],
    });
    expect(container.querySelector("[data-cl-fleet-schedule-chip]")).not.toBeNull();
    expect(container.querySelector('[data-cl-fleet-channel-chip="cron"]')).toBeNull();
    expect(container.querySelector('[data-cl-fleet-channel-chip="telegram"]')).not.toBeNull();
  });

  it("DOES render the cron chip when scheduleLabel is null (idle agent w/ historical cron)", () => {
    // Interactive mode → deriveScheduleLabel returns null; the cron chip
    // carries unique signal ("agent ran on cron in this window") and must
    // surface.
    const { container } = renderChart({
      agents: [makeAgent({ id: "histo", name: "histo", mode: "interactive" })],
      sessions: [makeSession({ sessionKey: "agent:histo:cron:job", agentId: "histo" })],
    });
    expect(container.querySelector("[data-cl-fleet-schedule-chip]")).toBeNull();
    expect(container.querySelector('[data-cl-fleet-channel-chip="cron"]')).not.toBeNull();
  });
});

// ── §2 — NOW label guard on the axis ──────────────────────

const RANGES = ["1h", "3h", "6h", "12h", "24h"] as const;

function nowAxisDistances(container: HTMLElement): number[] {
  // Axis labels live in the axis SVG's own coord space — viewBox `0 0 W 16`.
  // With isToday and no scheduled-agent ghost extension, endMs == nowMs, so
  // NOW sits at x == W in that coord space. Use the axis viewBox as ground
  // truth (NOT the cap's `left`, which lives in the strip's coord space —
  // they diverge in jsdom because the bounding-rect stub returns the same
  // width for every element).
  const axisSvg = container.querySelector("[data-cl-fleet-axis] svg");
  if (!axisSvg) throw new Error("axis SVG missing — required for guard test");
  const viewBox = axisSvg.getAttribute("viewBox") ?? "";
  const parts = viewBox.split(" ").map(Number);
  const axisWidth = parts[2];
  if (!Number.isFinite(axisWidth) || axisWidth <= 0) {
    throw new Error(`axis viewBox width invalid: ${viewBox}`);
  }
  const labels = container.querySelectorAll(
    "[data-cl-fleet-axis] svg text",
  ) as NodeListOf<SVGTextElement>;
  return [...labels].map((t) =>
    Math.abs(Number.parseFloat(t.getAttribute("x") ?? "NaN") - axisWidth),
  );
}

describe("FleetChart §2 — NOW label guard", () => {
  for (const range of RANGES) {
    it(`suppresses any axis label within 24px of NOW at range=${range}`, () => {
      // NOW falls on 12:00 sharp — every range whose tick interval lands at
      // an even hour produces a label exactly at NOW. The guard must hide it
      // (and any neighbour within 24 px).
      const { container } = renderChart({ range });
      const distances = nowAxisDistances(container);
      // Every axis label must be ≥24 px from NOW. (The tick line itself can
      // remain — that's a separate <line> element, not <text>.)
      for (const d of distances) expect(d).toBeGreaterThanOrEqual(24);
    });
  }

  it("keeps far-away labels visible (the guard is local, not global)", () => {
    const { container } = renderChart({ range: "24h" });
    const labels = container.querySelectorAll("[data-cl-fleet-axis] svg text");
    // At 24h with NOW=12pm, we expect MANY labels along the rest of the day.
    // The guard removes one or two at most.
    expect(labels.length).toBeGreaterThan(2);
  });

  it("still draws the tick line at the NOW position (only the text is suppressed)", () => {
    const { container } = renderChart({ range: "24h" });
    const tickLines = container.querySelectorAll("[data-cl-fleet-axis] svg line");
    // A baseline + N tick marks; we just need the tick mark count to exceed 1
    // so the suppressed-label tick still draws as a line.
    expect(tickLines.length).toBeGreaterThan(2);
  });

  it("does NOT apply the guard on the 7d view (no hour axis)", () => {
    const { container } = renderChart({ range: "7d" });
    // 7d has day-grid headers, not an hour axis. No axis SVG at all.
    expect(container.querySelector("[data-cl-fleet-axis]")).toBeNull();
  });
});

// ── §3 — dormancy hide ────────────────────────────────────

describe("FleetChart §3 — dormancy filter", () => {
  it("excludes a fully-dormant agent (no actions, no schedule, no channels, no attention) but renders the others", () => {
    const sessions = [
      // "active" — has sessions in window
      makeSession({
        sessionKey: "agent:active:main:s1",
        agentId: "active",
        actionCount: 5,
      }),
      // "channel" — only sessions are on a non-main catalog channel
      makeSession({
        sessionKey: "agent:channel:telegram:dm",
        agentId: "channel",
        actionCount: 2,
      }),
    ];
    const agents = [
      makeAgent({ id: "active", name: "active" }),
      makeAgent({
        id: "schedule",
        name: "schedule",
        mode: "scheduled",
        schedule: "0 */6 * * *",
      }),
      makeAgent({ id: "channel", name: "channel" }),
      makeAgent({
        id: "attn",
        name: "attn",
        status: "idle",
        needsAttention: true,
        lastActiveTimestamp: null,
      }),
      // Truly dormant: no sessions, interactive mode, no attention.
      makeAgent({
        id: "dormant",
        name: "dormant",
        status: "idle",
        lastActiveTimestamp: null,
      }),
    ];
    const { container } = renderChart({
      sessions,
      agents,
      range: "3h",
    });
    const renderedIds = [...container.querySelectorAll("[data-cl-fleet-row]")].map((r) =>
      r.getAttribute("data-cl-agent"),
    );
    expect(renderedIds).toContain("active");
    expect(renderedIds).toContain("schedule");
    expect(renderedIds).toContain("channel");
    expect(renderedIds).toContain("attn");
    expect(renderedIds).not.toContain("dormant");
    // The chart-body axis still renders; the empty-state copy must NOT
    // appear because non-dormant agents provide signal.
    expect(container.textContent).not.toMatch(/No agent activity in the last/);
  });

  it("excludes an idle scheduled agent that has neither a usable cadence nor a schedule string", () => {
    // mode="scheduled" without explicitSchedule and without any cron starts in
    // the window → deriveScheduleLabel returns null → row is dormant.
    const { container } = renderChart({
      sessions: [
        makeSession({
          sessionKey: "agent:keep:main:s1",
          agentId: "keep",
          actionCount: 1,
        }),
      ],
      agents: [
        makeAgent({ id: "keep", name: "keep" }),
        makeAgent({
          id: "ghost",
          name: "ghost",
          mode: "scheduled",
          status: "idle",
          lastActiveTimestamp: null,
        }),
      ],
    });
    const renderedIds = [...container.querySelectorAll("[data-cl-fleet-row]")].map((r) =>
      r.getAttribute("data-cl-agent"),
    );
    expect(renderedIds).toContain("keep");
    expect(renderedIds).not.toContain("ghost");
  });

  it("does NOT bypass the empty-state copy when every agent is dormant", () => {
    const { container } = renderChart({
      sessions: [],
      agents: [
        makeAgent({
          id: "d1",
          name: "d1",
          status: "idle",
          lastActiveTimestamp: null,
        }),
        makeAgent({
          id: "d2",
          name: "d2",
          status: "idle",
          lastActiveTimestamp: null,
        }),
      ],
      range: "6h",
    });
    expect(container.textContent).toMatch(/No agent activity in the last 6 hours/);
    // No fleet rows render (everyone is dormant).
    expect(container.querySelectorAll("[data-cl-fleet-row]")).toHaveLength(0);
  });
});

// ── §4 — unified top-N expander ───────────────────────────

describe("FleetChart §4 — unified top-N expander", () => {
  function manyActiveAgents(n: number) {
    const agents: AgentInfo[] = [];
    const sessions: TimelineSession[] = [];
    for (let i = 0; i < n; i++) {
      const id = `a${String(i).padStart(2, "0")}`;
      agents.push(makeAgent({ id, name: id, todayToolCalls: n - i }));
      sessions.push(
        makeSession({
          sessionKey: `agent:${id}:main:s`,
          agentId: id,
          actionCount: n - i,
        }),
      );
    }
    return { agents, sessions };
  }

  it("caps visible rows at 10 on desktop and renders a single 'Show N more' button", () => {
    const { agents, sessions } = manyActiveAgents(12);
    const { container } = renderChart({ agents, sessions });
    const visible = container.querySelectorAll("[data-cl-fleet-row]");
    expect(visible).toHaveLength(10);
    const buttons = container.querySelectorAll("[data-cl-fleet-more-toggle]");
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toMatch(/Show 2 more agents/);
    // Back-compat selector still works (Playwright + old tests).
    expect(container.querySelector("[data-cl-fleet-idle-toggle]")).not.toBeNull();
  });

  it("expands to render every non-dormant agent when the toggle is clicked", () => {
    const { agents, sessions } = manyActiveAgents(15);
    const { container } = renderChart({ agents, sessions });
    expect(container.querySelectorAll("[data-cl-fleet-row]")).toHaveLength(10);
    const toggle = container.querySelector("[data-cl-fleet-more-toggle]") as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    act(() => {
      fireEvent.click(toggle);
    });
    expect(container.querySelectorAll("[data-cl-fleet-row]")).toHaveLength(15);
    expect(toggle.textContent).toMatch(/Hide/);
  });

  it("uses the singular form when exactly 1 agent would be hidden", () => {
    const { agents, sessions } = manyActiveAgents(11);
    const { container } = renderChart({ agents, sessions });
    const toggle = container.querySelector("[data-cl-fleet-more-toggle]") as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    expect(toggle.textContent).toMatch(/Show 1 more agent\b/);
  });

  it("renders no expander when the agent count is at or below the cap", () => {
    const { agents, sessions } = manyActiveAgents(10);
    const { container } = renderChart({ agents, sessions });
    expect(container.querySelectorAll("[data-cl-fleet-row]")).toHaveLength(10);
    expect(container.querySelector("[data-cl-fleet-more-toggle]")).toBeNull();
    expect(container.querySelector("[data-cl-fleet-idle-toggle]")).toBeNull();
  });

  it("always keeps a needsAttention agent in the visible set, even when ranking would hide it", () => {
    // 14 noisy agents + 1 quiet attention agent. Ranking by total would put
    // the attention agent at the bottom — but the inline rule pulls it up.
    const { agents, sessions } = manyActiveAgents(14);
    agents.push(
      makeAgent({
        id: "z_attn",
        name: "z_attn",
        needsAttention: true,
        todayToolCalls: 0,
        status: "idle",
        lastActiveTimestamp: null,
      }),
    );
    const { container } = renderChart({ agents, sessions });
    const visible = [...container.querySelectorAll("[data-cl-fleet-row]")].map((r) =>
      r.getAttribute("data-cl-agent"),
    );
    expect(visible).toHaveLength(10);
    expect(visible).toContain("z_attn");
  });

  it("uses the mobile cap of 6 below the mobile width breakpoint", () => {
    // Stub the body bounding rect as mobile (< 640) so the chart picks the
    // smaller cap. The global beforeEach resets the prototype to desktop
    // between tests.
    Element.prototype.getBoundingClientRect = (): DOMRect =>
      ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 480,
        bottom: 56,
        width: 480,
        height: 56,
        toJSON: () => ({}),
      }) as DOMRect;
    const { agents, sessions } = manyActiveAgents(12);
    const { container } = renderChart({ agents, sessions });
    expect(container.querySelectorAll("[data-cl-fleet-row]")).toHaveLength(6);
    const toggle = container.querySelector("[data-cl-fleet-more-toggle]");
    expect(toggle).not.toBeNull();
    expect(toggle?.textContent).toMatch(/Show 6 more agents/);
  });
});

// ── §D4 — tight dot sizing (side-by-side fleet chart) ─────
//
// In the Stage D bottom row FleetChart shares width 50/50 with the LiveFeed.
// The dots are too small at that scale, so when fullscreen is false AND the
// measured width is >= 900px we bump the radii: routine 4→5, attention 6→7,
// cluster 8→9. At fullscreen=true the chart spans the full row and reverts
// to the comfy 4/6/8 sizes. Narrow viewports (<900px) stay at 4/6/8 because
// the chart already gets full width.

function firstDotRadius(container: HTMLElement): number | null {
  const dot = container.querySelector('[data-cl-fleet-dot][data-cl-cluster="false"] > circle');
  const r = dot?.getAttribute("r");
  if (!r) return null;
  return Number.parseFloat(r);
}

function firstAttentionRingRadius(container: HTMLElement): number | null {
  // Attention dots render with ring r = coreR + 2 — so core r = 7 when tight
  // and 6 when not. The attention core circle shares the same selector as a
  // routine dot; the ring sits alongside it at [data-cl-fleet-attention-ring].
  const dot = container.querySelector('[data-cl-fleet-dot][data-cl-cluster="false"] > circle');
  const r = dot?.getAttribute("r");
  if (!r) return null;
  return Number.parseFloat(r);
}

function firstClusterRadius(container: HTMLElement): number | null {
  const dot = container.querySelector('[data-cl-fleet-dot][data-cl-cluster="true"] > circle');
  const r = dot?.getAttribute("r");
  if (!r) return null;
  return Number.parseFloat(r);
}

describe("FleetChart §D4 — tight dot sizing", () => {
  it("defaults to TIGHT radii on desktop when fullscreen prop is omitted/false (routine=5)", () => {
    const { container } = renderChart({
      agents: [makeAgent({ id: "a1", name: "a1" })],
      sessions: [makeSession({ sessionKey: "agent:a1:main:s1", agentId: "a1" })],
    });
    expect(firstDotRadius(container)).toBe(5);
  });

  it("uses TIGHT attention dot radius (7) on desktop at fullscreen=false", () => {
    const { container } = renderChart({
      agents: [makeAgent({ id: "a1", name: "a1" })],
      sessions: [
        makeSession({
          sessionKey: "agent:a1:main:hi",
          agentId: "a1",
          peakRisk: 80, // CRITICAL → attention radius bucket
        }),
      ],
    });
    // With the tight toggle, attention core dots bump from 6 → 7.
    expect(firstAttentionRingRadius(container)).toBe(7);
  });

  it("uses TIGHT cluster radius (9) on desktop at fullscreen=false", () => {
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
    // The two sessions collapse into a single cluster marker.
    expect(firstClusterRadius(container)).toBe(9);
  });

  it("reverts to NORMAL radii (routine=4) when fullscreen=true", () => {
    mockApiReturn(response([makeSession({ sessionKey: "agent:a1:main:s1", agentId: "a1" })], "3h"));
    const { container } = render(
      <MemoryRouter>
        <FleetChart
          isToday
          selectedDate={null}
          range="3h"
          agents={[makeAgent({ id: "a1", name: "a1" })]}
          pendingSessionKeys={new Set()}
          fullscreen
          onToggleFullscreen={() => {}}
        />
      </MemoryRouter>,
    );
    expect(firstDotRadius(container)).toBe(4);
  });

  it("reverts to NORMAL attention radius (6) when fullscreen=true", () => {
    mockApiReturn(
      response(
        [
          makeSession({
            sessionKey: "agent:a1:main:hi",
            agentId: "a1",
            peakRisk: 80,
          }),
        ],
        "3h",
      ),
    );
    const { container } = render(
      <MemoryRouter>
        <FleetChart
          isToday
          selectedDate={null}
          range="3h"
          agents={[makeAgent({ id: "a1", name: "a1" })]}
          pendingSessionKeys={new Set()}
          fullscreen
          onToggleFullscreen={() => {}}
        />
      </MemoryRouter>,
    );
    expect(firstAttentionRingRadius(container)).toBe(6);
  });

  it("reverts to NORMAL cluster radius (8) when fullscreen=true", () => {
    const base = Date.parse(NOW_ISO) - 30 * 60_000;
    mockApiReturn(
      response(
        [
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
        "3h",
      ),
    );
    const { container } = render(
      <MemoryRouter>
        <FleetChart
          isToday
          selectedDate={null}
          range="3h"
          agents={[makeAgent({ id: "a1", name: "a1" })]}
          pendingSessionKeys={new Set()}
          fullscreen
          onToggleFullscreen={() => {}}
        />
      </MemoryRouter>,
    );
    expect(firstClusterRadius(container)).toBe(8);
  });

  it("stays at NORMAL radii on narrow viewports regardless of fullscreen (the chart already gets full width)", () => {
    // Stub a narrow viewport (< 900px). Tight is false → radii are 4/6/8.
    Element.prototype.getBoundingClientRect = (): DOMRect =>
      ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 640,
        bottom: 56,
        width: 640,
        height: 56,
        toJSON: () => ({}),
      }) as DOMRect;
    const { container } = renderChart({
      agents: [makeAgent({ id: "a1", name: "a1" })],
      sessions: [makeSession({ sessionKey: "agent:a1:main:s1", agentId: "a1" })],
    });
    expect(firstDotRadius(container)).toBe(4);
  });

  it("does NOT render the fullscreen toggle in the loading branch", () => {
    mockedUseApi.mockReturnValue({
      data: null,
      loading: true,
      error: null,
      refetch: vi.fn(),
    });
    const { container } = render(
      <MemoryRouter>
        <FleetChart
          isToday
          selectedDate={null}
          range="3h"
          agents={null}
          pendingSessionKeys={new Set()}
          fullscreen={false}
          onToggleFullscreen={() => {}}
        />
      </MemoryRouter>,
    );
    expect(container.querySelector("[data-cl-chart-fullscreen-toggle]")).toBeNull();
  });

  it("does NOT render the fullscreen toggle in the empty-state branch", () => {
    mockApiReturn({
      agents: [],
      sessions: [],
      startTime: new Date(Date.parse(NOW_ISO) - 3 * 3_600_000).toISOString(),
      endTime: NOW_ISO,
      totalActions: 0,
    });
    const { container } = render(
      <MemoryRouter>
        <FleetChart
          isToday
          selectedDate={null}
          range="3h"
          agents={[]}
          pendingSessionKeys={new Set()}
          fullscreen={false}
          onToggleFullscreen={() => {}}
        />
      </MemoryRouter>,
    );
    expect(container.querySelector("[data-cl-chart-fullscreen-toggle]")).toBeNull();
  });
});
