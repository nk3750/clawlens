// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class ResizeObserverShim {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverShim);

const STUB_CHART_WIDTH = 900;
const STUB_CHART_HEIGHT = 132;
Element.prototype.getBoundingClientRect = () =>
  ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: STUB_CHART_WIDTH,
    bottom: STUB_CHART_HEIGHT,
    width: STUB_CHART_WIDTH,
    height: STUB_CHART_HEIGHT,
    toJSON: () => ({}),
  }) as DOMRect;

vi.mock("../dashboard/src/hooks/useApi", () => ({
  useApi: vi.fn(),
}));
vi.mock("../dashboard/src/hooks/useSSE", () => ({
  useSSE: vi.fn(),
}));
vi.mock("../dashboard/src/hooks/useReducedMotion", () => ({
  useReducedMotion: vi.fn(() => false),
}));
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: vi.fn() };
});

import { useNavigate } from "react-router-dom";
import FleetActivityChart from "../dashboard/src/components/FleetActivityChart/FleetActivityChart";
import { useApi } from "../dashboard/src/hooks/useApi";
import { useSSE } from "../dashboard/src/hooks/useSSE";
import type {
  ActivityCategory,
  EntryResponse,
  FleetActivityResponse,
  RiskTier,
} from "../dashboard/src/lib/types";

const mockedUseApi = vi.mocked(useApi);
const mockedUseSSE = vi.mocked(useSSE);
const mockedUseNavigate = vi.mocked(useNavigate);
const navigateSpy = vi.fn();

const NOW = "2026-04-20T12:00:00.000Z";

function mkEntry(partial: Partial<EntryResponse> & { category: ActivityCategory }): EntryResponse {
  return {
    timestamp: new Date(Date.parse(NOW) - 30 * 60_000).toISOString(),
    toolName: "read",
    params: {},
    effectiveDecision: "allow",
    decision: "allow",
    toolCallId: `tc-${Math.random().toString(36).slice(2, 10)}`,
    sessionKey: "agent:a1:main:s1",
    agentId: "a1",
    ...partial,
  };
}

function mockApi(data: FleetActivityResponse | null, loading = false) {
  mockedUseApi.mockReturnValue({
    data,
    loading,
    error: null,
    refetch: vi.fn(),
  });
}

function response(entries: EntryResponse[]): FleetActivityResponse {
  return {
    entries,
    startTime: new Date(Date.parse(NOW) - 12 * 3_600_000).toISOString(),
    endTime: NOW,
    totalActions: entries.length,
    truncated: false,
  };
}

function renderChart(
  overrides: {
    entries?: EntryResponse[];
    selectedDate?: string | null;
    range?: "1h" | "3h" | "6h" | "12h" | "24h" | "48h" | "7d";
    onRangeChange?: (next: "1h" | "3h" | "6h" | "12h" | "24h" | "48h" | "7d") => void;
    fullscreen?: boolean;
    onToggleFullscreen?: () => void;
  } = {},
) {
  const entries = overrides.entries ?? [];
  mockApi(response(entries));
  return render(
    <MemoryRouter>
      <FleetActivityChart
        range={overrides.range ?? "12h"}
        selectedDate={overrides.selectedDate ?? null}
        onRangeChange={overrides.onRangeChange ?? vi.fn()}
        fullscreen={overrides.fullscreen}
        onToggleFullscreen={overrides.onToggleFullscreen}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  mockedUseSSE.mockImplementation(() => undefined);
  navigateSpy.mockReset();
  mockedUseNavigate.mockReturnValue(navigateSpy);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("FleetActivityChart — empty state", () => {
  it("renders the empty-state copy when there are no entries", () => {
    renderChart({ entries: [] });
    expect(screen.getByText(/no agent activity/i)).toBeInTheDocument();
  });

  it("renders a loading indicator while the first REST response is pending", () => {
    mockApi(null, true);
    render(
      <MemoryRouter>
        <FleetActivityChart range="12h" selectedDate={null} onRangeChange={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });
});

describe("FleetActivityChart — dot placement", () => {
  it("renders one [data-cl-swarm-dot] per entry when spread across different times", () => {
    // Spread 6 entries ~30 seconds apart so none cluster at 12h/900px.
    const base = Date.parse(NOW) - 10 * 60_000;
    const entries = Array.from({ length: 6 }, (_, i) =>
      mkEntry({
        category: (["exploring", "changes", "git", "scripts", "web", "comms"] as const)[i],
        timestamp: new Date(base + i * 60_000).toISOString(),
        toolCallId: `tc-${i}`,
      }),
    );
    const { container } = renderChart({ entries });
    expect(container.querySelectorAll("[data-cl-swarm-dot]")).toHaveLength(6);
  });

  it("places each dot in its category lane (cy ascending by LANE_ORDER)", () => {
    const base = Date.parse(NOW) - 30 * 60_000;
    const cats: ActivityCategory[] = ["exploring", "changes", "git", "scripts", "web", "comms"];
    const entries = cats.map((cat, i) =>
      mkEntry({
        category: cat,
        // Spread wide enough to avoid clustering at 12h / 900px width.
        timestamp: new Date(base + i * 60 * 60_000).toISOString(),
        toolCallId: `tc-${cat}`,
      }),
    );
    const { container } = renderChart({ entries });
    const dots = [...container.querySelectorAll("[data-cl-swarm-dot]")];
    // Map dots to their cy by matching the category attribute.
    const byCat = new Map<string, number>();
    for (const g of dots) {
      const cat = g.getAttribute("data-cl-swarm-cat") ?? "";
      const circle = g.querySelector("circle");
      const cy = Number.parseFloat(circle?.getAttribute("cy") ?? "NaN");
      byCat.set(cat, cy);
    }
    // exploring (lane 0) must sit higher than comms (lane 5).
    for (let i = 1; i < cats.length; i++) {
      const prev = byCat.get(cats[i - 1]);
      const cur = byCat.get(cats[i]);
      // Jitter is bounded at ±35% of lane height, and lane centers are one
      // lane apart, so the adjacent lane's center is strictly further down.
      expect(prev ?? Number.NaN).toBeLessThan((cur ?? Number.NaN) + 1);
    }
  });

  it("strokes the dot icon with the category color (no filled disc)", () => {
    const entries = [mkEntry({ category: "git", toolCallId: "t1" })];
    const { container } = renderChart({ entries });
    const iconSvg = container.querySelector("[data-cl-swarm-dot] svg");
    expect(iconSvg?.getAttribute("stroke")).toBe("var(--cl-cat-commands)");
    // No fill circle remains — only the transparent hit target + icon path.
    const fillCircles = [...container.querySelectorAll("[data-cl-swarm-dot] > circle")].filter(
      (c) => {
        const f = c.getAttribute("fill");
        return f !== "transparent" && f !== "none";
      },
    );
    expect(fillCircles).toHaveLength(0);
  });

  it("renders a transparent hit target circle so clicks land reliably", () => {
    const entries = [mkEntry({ category: "git", toolCallId: "t1" })];
    const { container } = renderChart({ entries });
    const hit = container.querySelector('[data-cl-swarm-dot] circle[fill="transparent"]');
    expect(hit).not.toBeNull();
  });
});

describe("FleetActivityChart — clustering", () => {
  it("merges two close same-lane dots into a single cluster marker with '+N' count", () => {
    // Two entries 100 ms apart in the same lane at 12h/900px ≈ 0.002 px apart.
    const base = Date.parse(NOW) - 30 * 60_000;
    const entries = [
      mkEntry({
        category: "exploring",
        timestamp: new Date(base).toISOString(),
        toolCallId: "a",
      }),
      mkEntry({
        category: "exploring",
        timestamp: new Date(base + 100).toISOString(),
        toolCallId: "b",
      }),
    ];
    const { container } = renderChart({ entries });
    const dots = container.querySelectorAll("[data-cl-swarm-dot]");
    expect(dots).toHaveLength(1);
    expect(dots[0].getAttribute("data-cl-swarm-cluster")).toBe("true");
    expect(dots[0].querySelector("[data-cl-swarm-cluster-count]")?.textContent).toBe("+2");
  });

  it("does NOT merge dots from different lanes at the same cx", () => {
    const base = Date.parse(NOW) - 30 * 60_000;
    const entries = [
      mkEntry({
        category: "exploring",
        timestamp: new Date(base).toISOString(),
        toolCallId: "explore",
      }),
      mkEntry({
        category: "comms",
        timestamp: new Date(base + 50).toISOString(),
        toolCallId: "comms",
      }),
    ];
    const { container } = renderChart({ entries });
    const dots = container.querySelectorAll("[data-cl-swarm-dot]");
    expect(dots).toHaveLength(2);
    for (const d of dots) expect(d.getAttribute("data-cl-swarm-cluster")).toBe("false");
  });
});

describe("FleetActivityChart — risk halos", () => {
  it("renders a halo ring for high-risk entries", () => {
    const entries = [mkEntry({ category: "changes", riskTier: "high", toolCallId: "high" })];
    const { container } = renderChart({ entries });
    expect(container.querySelector("[data-cl-swarm-halo]")).not.toBeNull();
  });

  it("renders a halo ring for critical-risk entries", () => {
    const entries = [mkEntry({ category: "changes", riskTier: "critical", toolCallId: "crit" })];
    const { container } = renderChart({ entries });
    expect(container.querySelector("[data-cl-swarm-halo]")).not.toBeNull();
  });

  it("does NOT render a halo for low-risk entries", () => {
    const entries = [mkEntry({ category: "changes", riskTier: "low", toolCallId: "low" })];
    const { container } = renderChart({ entries });
    expect(container.querySelector("[data-cl-swarm-halo]")).toBeNull();
  });

  it("does NOT render a halo for medium-risk entries (color collides with category green/amber)", () => {
    const entries = [mkEntry({ category: "changes", riskTier: "medium", toolCallId: "med" })];
    const { container } = renderChart({ entries });
    expect(container.querySelector("[data-cl-swarm-halo]")).toBeNull();
  });

  it("uses the worst-tier halo for a cluster (critical beats high)", () => {
    const base = Date.parse(NOW) - 30 * 60_000;
    const entries: EntryResponse[] = [
      mkEntry({
        category: "git",
        timestamp: new Date(base).toISOString(),
        toolCallId: "a",
        riskTier: "high",
      }),
      mkEntry({
        category: "git",
        timestamp: new Date(base + 100).toISOString(),
        toolCallId: "b",
        riskTier: "critical" as RiskTier,
      }),
    ];
    const { container } = renderChart({ entries });
    const dot = container.querySelector("[data-cl-swarm-dot]");
    expect(dot?.getAttribute("data-cl-swarm-cluster")).toBe("true");
    expect(dot?.getAttribute("data-cl-swarm-tier")).toBe("critical");
    expect(dot?.querySelector("[data-cl-swarm-halo]")).not.toBeNull();
  });
});

describe("FleetActivityChart — click-through", () => {
  it("navigates to /session/:key with highlightToolCallId state when a single dot is clicked", () => {
    const entry = mkEntry({
      category: "git",
      toolCallId: "click-me",
      sessionKey: "agent:a1:main:s1",
    });
    const { container } = renderChart({ entries: [entry] });
    const dot = container.querySelector("[data-cl-swarm-dot]") as SVGGElement | null;
    expect(dot).not.toBeNull();
    if (!dot) return;
    act(() => {
      fireEvent.click(dot);
    });
    expect(navigateSpy).toHaveBeenCalledWith(`/session/${encodeURIComponent("agent:a1:main:s1")}`, {
      state: { highlightToolCallId: "click-me" },
    });
  });

  it("opens the SwarmPopover when a cluster is clicked (no navigation)", () => {
    const base = Date.parse(NOW) - 30 * 60_000;
    const entries: EntryResponse[] = [
      mkEntry({
        category: "scripts",
        timestamp: new Date(base).toISOString(),
        toolCallId: "a",
      }),
      mkEntry({
        category: "scripts",
        timestamp: new Date(base + 100).toISOString(),
        toolCallId: "b",
      }),
    ];
    const { container } = renderChart({ entries });
    const dot = container.querySelector(
      '[data-cl-swarm-dot][data-cl-swarm-cluster="true"]',
    ) as SVGGElement | null;
    expect(dot).not.toBeNull();
    if (!dot) return;
    act(() => {
      fireEvent.click(dot);
    });
    // Popover is portaled to document.body — not inside `container`.
    expect(document.querySelector("[data-cl-swarm-popover]")).not.toBeNull();
    const rows = document.querySelectorAll("[data-cl-swarm-popover-row]");
    expect(rows).toHaveLength(2);
  });

  it("navigates when a popover row is clicked", () => {
    const base = Date.parse(NOW) - 30 * 60_000;
    const entries: EntryResponse[] = [
      mkEntry({
        category: "web",
        timestamp: new Date(base).toISOString(),
        toolCallId: "row-a",
        sessionKey: "agent:a1:main:s1",
      }),
      mkEntry({
        category: "web",
        timestamp: new Date(base + 100).toISOString(),
        toolCallId: "row-b",
        sessionKey: "agent:a1:main:s2",
      }),
    ];
    const { container } = renderChart({ entries });
    const cluster = container.querySelector(
      '[data-cl-swarm-dot][data-cl-swarm-cluster="true"]',
    ) as SVGGElement | null;
    if (!cluster) throw new Error("cluster not rendered");
    act(() => {
      fireEvent.click(cluster);
    });
    const row = document.querySelector("[data-cl-swarm-popover-row]") as HTMLElement | null;
    if (!row) throw new Error("popover row missing");
    act(() => {
      fireEvent.click(row);
    });
    expect(navigateSpy).toHaveBeenCalledWith(`/session/${encodeURIComponent("agent:a1:main:s1")}`, {
      state: { highlightToolCallId: "row-a" },
    });
  });

  it("closes the popover on Escape", () => {
    const base = Date.parse(NOW) - 30 * 60_000;
    const entries: EntryResponse[] = [
      mkEntry({
        category: "comms",
        timestamp: new Date(base).toISOString(),
        toolCallId: "a",
      }),
      mkEntry({
        category: "comms",
        timestamp: new Date(base + 100).toISOString(),
        toolCallId: "b",
      }),
    ];
    const { container } = renderChart({ entries });
    const cluster = container.querySelector(
      '[data-cl-swarm-dot][data-cl-swarm-cluster="true"]',
    ) as SVGGElement | null;
    if (!cluster) throw new Error("cluster missing");
    act(() => {
      fireEvent.click(cluster);
    });
    expect(document.querySelector("[data-cl-swarm-popover]")).not.toBeNull();
    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(document.querySelector("[data-cl-swarm-popover]")).toBeNull();
  });

  it("does not attach a click handler when the entry has no sessionKey", () => {
    const entries: EntryResponse[] = [
      mkEntry({
        category: "exploring",
        toolCallId: "orphan",
        sessionKey: undefined,
      }),
    ];
    const { container } = renderChart({ entries });
    const dot = container.querySelector("[data-cl-swarm-dot]");
    expect(dot?.getAttribute("data-cl-swarm-clickable")).toBe("false");
  });
});

describe("FleetActivityChart — header + range pills", () => {
  it("renders a radiogroup labeled 'Time range' in the chart header", () => {
    const { container } = renderChart();
    expect(container.querySelector('[role="radiogroup"][aria-label="Time range"]')).not.toBeNull();
  });

  it("fires onRangeChange with the clicked pill value", () => {
    const onRangeChange = vi.fn();
    const { container } = renderChart({ onRangeChange });
    const pills = [...container.querySelectorAll('[role="radio"]')];
    const threeHour = pills.find((p) => p.textContent?.trim() === "3h");
    if (!threeHour) throw new Error("3h pill missing");
    act(() => {
      fireEvent.click(threeHour);
    });
    expect(onRangeChange).toHaveBeenCalledWith("3h");
  });

  it("shows a 48h pill (new range added for the swarm chart)", () => {
    const { container } = renderChart();
    const pills = [...container.querySelectorAll('[role="radio"]')];
    expect(pills.some((p) => p.textContent?.trim() === "48h")).toBe(true);
  });

  it("fires onToggleFullscreen when the maximize button is clicked", () => {
    const onToggleFullscreen = vi.fn();
    const { container } = renderChart({ onToggleFullscreen });
    const btn = container.querySelector(
      "[data-cl-swarm-fullscreen-toggle]",
    ) as HTMLButtonElement | null;
    if (!btn) throw new Error("toggle missing");
    act(() => {
      fireEvent.click(btn);
    });
    expect(onToggleFullscreen).toHaveBeenCalledTimes(1);
  });
});

describe("FleetActivityChart — SSE subscription", () => {
  it("subscribes to api/stream when viewing today", () => {
    renderChart({ selectedDate: null });
    expect(mockedUseSSE).toHaveBeenCalled();
    const firstArg = mockedUseSSE.mock.calls[0][0];
    expect(firstArg).toBe("api/stream");
  });

  it("passes null to useSSE when viewing a past date (no subscription)", () => {
    renderChart({ selectedDate: "2026-04-15" });
    expect(mockedUseSSE).toHaveBeenCalled();
    const firstArg = mockedUseSSE.mock.calls[0][0];
    expect(firstArg).toBe(null);
  });
});

describe("FleetActivityChart — now line", () => {
  it("renders a now line on today views", () => {
    const { container } = renderChart({
      selectedDate: null,
      entries: [mkEntry({ category: "exploring" })],
    });
    expect(container.querySelector("[data-cl-swarm-now-line]")).not.toBeNull();
  });

  it("does NOT render a now line on past-date views", () => {
    const { container } = renderChart({ selectedDate: "2026-04-15" });
    expect(container.querySelector("[data-cl-swarm-now-line]")).toBeNull();
  });
});

describe("FleetActivityChart — legend", () => {
  it("renders a legend chip for every ActivityCategory", () => {
    const { container } = renderChart();
    const chips = container.querySelectorAll("[data-cl-swarm-legend-chip]");
    expect(chips.length).toBe(6);
    const ids = [...chips].map((el) => el.getAttribute("data-cl-swarm-legend-chip"));
    expect(ids).toEqual(["exploring", "changes", "git", "scripts", "web", "comms"]);
  });
});

// ── Polish pass ────────────────────────────────────────────

describe("FleetActivityChart — lane labels (left gutter)", () => {
  it("renders one [data-cl-swarm-lane-label] per category in LANE_ORDER", () => {
    const { container } = renderChart();
    const labels = container.querySelectorAll("[data-cl-swarm-lane-label]");
    const ids = [...labels].map((el) => el.getAttribute("data-cl-swarm-lane-label"));
    expect(ids).toEqual(["exploring", "changes", "git", "scripts", "web", "comms"]);
  });

  it("lane labels show the CATEGORY_META short-lowercase form", () => {
    const { container } = renderChart();
    const labels = container.querySelectorAll("[data-cl-swarm-lane-label]");
    const texts = [...labels].map((el) => el.textContent);
    expect(texts).toEqual(["exploring", "changes", "git", "scripts", "web", "comms"]);
  });

  it("lane labels render even when all lanes are empty — empty is a signal", () => {
    const { container } = renderChart({ entries: [] });
    expect(container.querySelectorAll("[data-cl-swarm-lane-label]").length).toBe(6);
  });

  it("renders one [data-cl-swarm-lane-icon] per category, stroked with the category color", () => {
    const { container } = renderChart();
    const icons = [...container.querySelectorAll("[data-cl-swarm-lane-icon]")];
    const ids = icons.map((el) => el.getAttribute("data-cl-swarm-lane-icon"));
    expect(ids).toEqual(["exploring", "changes", "git", "scripts", "web", "comms"]);
    const expectedStrokes: Record<string, string> = {
      exploring: "var(--cl-cat-exploring)",
      changes: "var(--cl-cat-changes)",
      git: "var(--cl-cat-commands)",
      scripts: "var(--cl-cat-data)",
      web: "var(--cl-cat-web)",
      comms: "var(--cl-cat-comms)",
    };
    for (const icon of icons) {
      const cat = icon.getAttribute("data-cl-swarm-lane-icon") ?? "";
      expect(icon.getAttribute("stroke")).toBe(expectedStrokes[cat]);
      // Icon contains at least one <path> (from CATEGORY_META[cat].iconPath).
      expect(icon.querySelector("path")).not.toBeNull();
    }
  });
});

describe("FleetActivityChart — now-line visibility", () => {
  it("sits 4px inside the right edge of the main chart (not clipped)", () => {
    const { container } = renderChart();
    const line = container.querySelector("[data-cl-swarm-now-line]") as SVGLineElement | null;
    expect(line).not.toBeNull();
    // Stub returns body width = STUB_CHART_WIDTH (900). Gutter is 96 so the
    // main chart width = 804; now line at 800.
    const x1 = Number.parseFloat(line?.getAttribute("x1") ?? "NaN");
    expect(x1).toBe(804 - 4);
  });

  it("uses the accent color, bolder stroke, and a persistent drop-shadow aura", () => {
    const { container } = renderChart();
    const line = container.querySelector("[data-cl-swarm-now-line]") as SVGLineElement | null;
    expect(line?.getAttribute("stroke")).toBe("var(--cl-accent)");
    expect(line?.getAttribute("stroke-opacity")).toBe("0.7");
    expect(line?.getAttribute("stroke-width")).toBe("2");
    // Inline style applies a persistent drop-shadow so the line reads "live"
    // at rest without depending on the pulse/burst keyframes.
    expect(line?.style.filter).toMatch(/drop-shadow/);
  });

  it("renders a NOW ▼ caption + arrow on the today view, both accent-colored", () => {
    const { container } = renderChart();
    const caption = container.querySelector("[data-cl-swarm-now-caption]") as SVGTextElement | null;
    const arrow = container.querySelector("[data-cl-swarm-now-arrow]");
    expect(caption).not.toBeNull();
    expect(arrow).not.toBeNull();
    expect(caption?.textContent).toBe("NOW");
    expect(caption?.style.fill).toContain("--cl-accent");
    expect(arrow?.getAttribute("fill")).toBe("var(--cl-accent)");
  });

  it("right-aligns the NOW caption so it cannot clip past the chart's right edge", () => {
    const { container } = renderChart();
    const caption = container.querySelector("[data-cl-swarm-now-caption]");
    expect(caption?.getAttribute("text-anchor")).toBe("end");
  });

  it("lifts the NOW caption above the chart (y=-6) so exploring-lane dots don't collide", () => {
    const { container } = renderChart();
    const caption = container.querySelector("[data-cl-swarm-now-caption]");
    expect(caption?.getAttribute("y")).toBe("-6");
  });

  it("places the arrow in the top margin (base at y=-2, apex at y=4)", () => {
    const { container } = renderChart();
    const arrow = container.querySelector("[data-cl-swarm-now-arrow]");
    const points = arrow?.getAttribute("points") ?? "";
    // Base y=-2 (in the reserved margin), apex y=4 (just inside the chart).
    expect(points).toMatch(/,-2 /);
    expect(points).toMatch(/,-2$|,4$/);
    expect(points).toContain(",4");
  });

  it("does NOT render the caption/arrow on past-date views", () => {
    const { container } = renderChart({ selectedDate: "2026-04-15" });
    expect(container.querySelector("[data-cl-swarm-now-caption]")).toBeNull();
    expect(container.querySelector("[data-cl-swarm-now-arrow]")).toBeNull();
  });
});

describe("FleetActivityChart — dot icons", () => {
  it("renders the category iconPath on single dots, stroked with the category color", () => {
    const entries = [mkEntry({ category: "git", toolCallId: "solo" })];
    const { container } = renderChart({ entries });
    const dot = container.querySelector('[data-cl-swarm-dot][data-cl-swarm-cluster="false"]');
    expect(dot).not.toBeNull();
    const iconSvg = dot?.querySelector("svg");
    expect(iconSvg?.getAttribute("stroke")).toBe("var(--cl-cat-commands)");
    expect(iconSvg?.querySelector("path")).not.toBeNull();
  });

  it("renders the SAME icon treatment on cluster dots (icon + '+N' badge)", () => {
    const base = Date.parse(NOW) - 30 * 60_000;
    const entries: EntryResponse[] = [
      mkEntry({ category: "web", timestamp: new Date(base).toISOString(), toolCallId: "a" }),
      mkEntry({ category: "web", timestamp: new Date(base + 100).toISOString(), toolCallId: "b" }),
    ];
    const { container } = renderChart({ entries });
    const cluster = container.querySelector('[data-cl-swarm-dot][data-cl-swarm-cluster="true"]');
    expect(cluster).not.toBeNull();
    const iconSvg = cluster?.querySelector("svg");
    expect(iconSvg?.getAttribute("stroke")).toBe("var(--cl-cat-web)");
    expect(iconSvg?.querySelector("path")).not.toBeNull();
    expect(cluster?.querySelector("[data-cl-swarm-cluster-count]")?.textContent).toBe("+2");
  });

  it("gives both singles and clusters a transparent hit target", () => {
    const base = Date.parse(NOW) - 30 * 60_000;
    const entries: EntryResponse[] = [
      mkEntry({ category: "web", timestamp: new Date(base).toISOString(), toolCallId: "a" }),
      mkEntry({ category: "web", timestamp: new Date(base + 100).toISOString(), toolCallId: "b" }),
      mkEntry({
        category: "exploring",
        timestamp: new Date(base - 1800_000).toISOString(),
        toolCallId: "c",
      }),
    ];
    const { container } = renderChart({ entries });
    const dots = [...container.querySelectorAll("[data-cl-swarm-dot]")];
    for (const d of dots) {
      expect(d.querySelector('circle[fill="transparent"]')).not.toBeNull();
    }
  });
});

describe("FleetActivityChart — overflow guards (unclip cluster labels)", () => {
  it("main chart svg has overflow=visible so cluster '+N' labels above y=0 aren't clipped", () => {
    const { container } = renderChart();
    const svgs = [...container.querySelectorAll("svg")];
    // Find the main chart svg — it has a <title>Fleet activity swarm chart</title>.
    const main = svgs.find(
      (svg) => svg.querySelector("title")?.textContent === "Fleet activity swarm chart",
    );
    expect(main).toBeDefined();
    expect(main?.getAttribute("overflow")).toBe("visible");
  });

  it("reserves 20px of top margin so the NOW caption and cluster labels both sit above the chart cleanly", () => {
    const { container } = renderChart();
    const body = container.querySelector("[data-cl-swarm-body]") as HTMLElement | null;
    expect(body).not.toBeNull();
    expect(body?.style.marginTop).toBe("20px");
  });
});

describe("FleetActivityChart — clamp dots to now-line", () => {
  it("clamps a future-timestamped dot to nowX on today view (no future activity past the line)", () => {
    const future = new Date(Date.parse(NOW) + 10_000).toISOString();
    const entries = [mkEntry({ category: "exploring", timestamp: future, toolCallId: "future" })];
    const { container } = renderChart({ entries });
    const circle = container.querySelector("[data-cl-swarm-dot] circle") as SVGCircleElement | null;
    expect(circle).not.toBeNull();
    const cx = Number.parseFloat(circle?.getAttribute("cx") ?? "NaN");
    // Expected: nowX = chartWidth - NOW_LINE_INSET = 804 - 4 = 800.
    expect(cx).toBe(800);
  });
});
