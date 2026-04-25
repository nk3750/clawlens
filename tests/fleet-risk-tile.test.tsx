// @vitest-environment jsdom
//
// Tests for the FleetRiskTile component (spec §6).
// Exhaustive coverage of hero values, sparkline + tape rendering, NOW line
// singleness, tape-dot click navigation, and empty/edge states.

import { fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class ResizeObserverShim {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverShim);

vi.mock("../dashboard/src/hooks/useApi", () => ({
  useApi: vi.fn(),
}));
// useLiveApi (introduced in #23) wraps useApi + useSSE. Mocking useSSE to a
// no-op keeps the existing useApi-shaped mocks below working without spinning
// up an EventSource against a fake JSDOM URL.
vi.mock("../dashboard/src/hooks/useSSE", () => ({
  useSSE: vi.fn(),
}));
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: vi.fn() };
});

import { useNavigate } from "react-router-dom";
import FleetRiskTile from "../dashboard/src/components/FleetRiskTile/FleetRiskTile";
import { useApi } from "../dashboard/src/hooks/useApi";
import type {
  EntryResponse,
  FleetActivityResponse,
  FleetRiskIndexResponse,
} from "../dashboard/src/lib/types";

const mockedUseApi = vi.mocked(useApi);
const mockedUseNavigate = vi.mocked(useNavigate);
const navigateSpy = vi.fn();

const NOW_ISO = "2026-04-24T12:00:00.000Z";
const NOW_MS = Date.parse(NOW_ISO);

function mkEntry(partial: Partial<EntryResponse> = {}): EntryResponse {
  return {
    timestamp: new Date(NOW_MS - 30 * 60_000).toISOString(),
    toolName: "exec",
    params: { command: "something" },
    effectiveDecision: "allow",
    decision: "allow",
    category: "scripts",
    toolCallId: `tc-${Math.random().toString(36).slice(2, 10)}`,
    sessionKey: "agent:a1:main:s1",
    agentId: "a1",
    riskScore: 60,
    ...partial,
  };
}

function fleetActivity(entries: EntryResponse[]): FleetActivityResponse {
  return {
    entries,
    startTime: new Date(NOW_MS - 24 * 3_600_000).toISOString(),
    endTime: NOW_ISO,
    totalActions: entries.length,
    truncated: false,
  };
}

/** Wire both useApi calls — fleet-activity and fleet-risk-index, in that order. */
function mockApis(activity: FleetActivityResponse, index: FleetRiskIndexResponse) {
  mockedUseApi.mockImplementation((path: string) => {
    if (path.startsWith("api/fleet-activity")) {
      return { data: activity, loading: false, error: null, refetch: vi.fn() };
    }
    if (path === "api/fleet-risk-index") {
      return { data: index, loading: false, error: null, refetch: vi.fn() };
    }
    return { data: null, loading: false, error: null, refetch: vi.fn() };
  });
}

function renderTile(
  opts: {
    range?: "1h" | "3h" | "6h" | "12h" | "24h" | "48h" | "7d";
    selectedDate?: string | null;
  } = {},
) {
  return render(
    <MemoryRouter>
      <FleetRiskTile range={opts.range ?? "24h"} selectedDate={opts.selectedDate ?? null} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW_ISO));
  navigateSpy.mockReset();
  mockedUseNavigate.mockReturnValue(navigateSpy);
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────
// Hero (spec §6.2)
// ─────────────────────────────────────────────────────────────

describe("FleetRiskTile hero", () => {
  it("renders current / delta / counts / baseline line", () => {
    mockApis(fleetActivity([]), {
      current: 80,
      baselineP50: 40,
      delta: 40,
      critCount: 3,
      highCount: 5,
      totalElevated: 8,
    });
    const { container } = renderTile();
    const hero = container.querySelector("[data-cl-fleet-risk-hero]");
    expect(hero).not.toBeNull();
    const text = hero?.textContent ?? "";
    expect(text).toContain("80"); // current
    expect(text).toContain("+40"); // delta with sign
    expect(text).toContain("3 crit");
    expect(text).toContain("5 high");
    expect(text.toLowerCase()).toContain("baseline");
  });
  it('does NOT prepend a "+" to a negative delta', () => {
    mockApis(fleetActivity([]), {
      current: 20,
      baselineP50: 50,
      delta: -30,
      critCount: 0,
      highCount: 0,
      totalElevated: 0,
    });
    const { container } = renderTile();
    const text = container.querySelector("[data-cl-fleet-risk-hero]")?.textContent ?? "";
    expect(text).toContain("-30");
    expect(text).not.toContain("+-");
  });
  it("tier-colors the current number based on threshold", () => {
    mockApis(fleetActivity([]), {
      current: 90,
      baselineP50: 40,
      delta: 50,
      critCount: 1,
      highCount: 0,
      totalElevated: 1,
    });
    const { container } = renderTile();
    const num = container.querySelector<HTMLElement>("[data-cl-fleet-risk-current]");
    expect(num).not.toBeNull();
    // crit (>=75) → risk-critical color
    expect(num?.style.color).toMatch(/cl-risk-critical/);
  });
  it("uses risk-high color for delta when delta > 0", () => {
    mockApis(fleetActivity([]), {
      current: 80,
      baselineP50: 40,
      delta: 40,
      critCount: 0,
      highCount: 0,
      totalElevated: 0,
    });
    const { container } = renderTile();
    const delta = container.querySelector<HTMLElement>("[data-cl-fleet-risk-delta]");
    expect(delta?.style.color).toMatch(/cl-risk-high/);
  });
  it('renders "0 vs 7d baseline" (no "+") when delta is exactly zero', () => {
    mockApis(fleetActivity([]), {
      current: 40,
      baselineP50: 40,
      delta: 0,
      critCount: 0,
      highCount: 0,
      totalElevated: 0,
    });
    const { container } = renderTile();
    const delta = container.querySelector<HTMLElement>("[data-cl-fleet-risk-delta]");
    expect(delta?.textContent).toBe("0 vs 7d baseline");
  });
  it("delta label refers to the 7d baseline, not 24h (polish §2.3)", () => {
    mockApis(fleetActivity([]), {
      current: 80,
      baselineP50: 40,
      delta: 40,
      critCount: 0,
      highCount: 0,
      totalElevated: 0,
    });
    const { container } = renderTile();
    const text = container.querySelector("[data-cl-fleet-risk-hero]")?.textContent ?? "";
    expect(text).toContain("7d baseline");
    expect(text).not.toContain("24h baseline");
  });
  it("uses text-secondary color for delta when delta <= 0", () => {
    mockApis(fleetActivity([]), {
      current: 20,
      baselineP50: 40,
      delta: -20,
      critCount: 0,
      highCount: 0,
      totalElevated: 0,
    });
    const { container } = renderTile();
    const delta = container.querySelector<HTMLElement>("[data-cl-fleet-risk-delta]");
    expect(delta?.style.color).toMatch(/cl-text-secondary/);
  });
});

// ─────────────────────────────────────────────────────────────
// Sparkline (spec §6.3)
// ─────────────────────────────────────────────────────────────

describe("FleetRiskTile sparkline — 4-tier stacked volume area (volume-area spec)", () => {
  it("renders exactly 4 stacked fill polygons — low / medium / high / critical", () => {
    mockApis(fleetActivity([mkEntry({ riskTier: "high", riskScore: 60 })]), {
      current: 60,
      baselineP50: 40,
      delta: 20,
      critCount: 0,
      highCount: 1,
      totalElevated: 1,
    });
    const { container } = renderTile();
    const paths = container.querySelectorAll("path[data-cl-fleet-risk-sparkline]");
    expect(paths.length).toBe(4);
    const kinds = Array.from(paths).map((p) => p.getAttribute("data-cl-fleet-risk-sparkline"));
    expect(new Set(kinds)).toEqual(new Set(["low", "medium", "high", "critical"]));
  });
  it("renders 4 stroke top-line paths — low / medium / high / critical", () => {
    mockApis(fleetActivity([mkEntry({ riskTier: "high", riskScore: 60 })]), {
      current: 60,
      baselineP50: 40,
      delta: 20,
      critCount: 0,
      highCount: 1,
      totalElevated: 1,
    });
    const { container } = renderTile();
    const lines = container.querySelectorAll("path[data-cl-fleet-risk-sparkline-line]");
    expect(lines.length).toBe(4);
    const kinds = Array.from(lines).map((p) => p.getAttribute("data-cl-fleet-risk-sparkline-line"));
    expect(new Set(kinds)).toEqual(new Set(["low", "medium", "high", "critical"]));
  });
  it("colors the high band with --cl-risk-high (salmon, NOT --cl-risk-medium amber) — locks tape↔chart parity", () => {
    // The volume-area spec inverts the #23 high-band token so HIGH on the
    // chart (score 50–74) matches the salmon HIGH lane on the tape directly
    // below it. Reusing --cl-risk-medium (amber) here was the cross-component
    // color conflict that motivated this redesign.
    mockApis(fleetActivity([mkEntry({ riskTier: "high", riskScore: 60 })]), {
      current: 60,
      baselineP50: 40,
      delta: 20,
      critCount: 0,
      highCount: 1,
      totalElevated: 1,
    });
    const { container } = renderTile();
    const byKind = new Map(
      Array.from(
        container.querySelectorAll<SVGPathElement>("path[data-cl-fleet-risk-sparkline]"),
      ).map((p) => [p.getAttribute("data-cl-fleet-risk-sparkline"), p] as const),
    );
    expect(byKind.get("low")?.getAttribute("fill")).toMatch(/cl-risk-low/);
    expect(byKind.get("medium")?.getAttribute("fill")).toMatch(/cl-risk-medium/);
    // ↓ The central correctness assertion: HIGH band uses salmon, not amber.
    expect(byKind.get("high")?.getAttribute("fill")).toMatch(/cl-risk-high/);
    expect(byKind.get("high")?.getAttribute("fill")).not.toMatch(/cl-risk-medium/);
    expect(byKind.get("critical")?.getAttribute("fill")).toMatch(/cl-risk-critical/);
  });
  it("colors each top-line stroke with the matching tier token (high stroke = salmon)", () => {
    mockApis(fleetActivity([mkEntry({ riskTier: "high", riskScore: 60 })]), {
      current: 60,
      baselineP50: 40,
      delta: 20,
      critCount: 0,
      highCount: 1,
      totalElevated: 1,
    });
    const { container } = renderTile();
    const byKind = new Map(
      Array.from(
        container.querySelectorAll<SVGPathElement>("path[data-cl-fleet-risk-sparkline-line]"),
      ).map((p) => [p.getAttribute("data-cl-fleet-risk-sparkline-line"), p] as const),
    );
    expect(byKind.get("low")?.getAttribute("stroke")).toMatch(/cl-risk-low/);
    expect(byKind.get("medium")?.getAttribute("stroke")).toMatch(/cl-risk-medium/);
    expect(byKind.get("high")?.getAttribute("stroke")).toMatch(/cl-risk-high/);
    expect(byKind.get("high")?.getAttribute("stroke")).not.toMatch(/cl-risk-medium/);
    expect(byKind.get("critical")?.getAttribute("stroke")).toMatch(/cl-risk-critical/);
  });
  it("uses uniform fill-opacity 0.85 across all 4 bands (stacked, not overlapping)", () => {
    mockApis(fleetActivity([mkEntry({ riskTier: "high", riskScore: 60 })]), {
      current: 60,
      baselineP50: 40,
      delta: 20,
      critCount: 0,
      highCount: 1,
      totalElevated: 1,
    });
    const { container } = renderTile();
    const paths = Array.from(
      container.querySelectorAll<SVGPathElement>("path[data-cl-fleet-risk-sparkline]"),
    );
    for (const p of paths) {
      expect(p.getAttribute("fill-opacity")).toBe("0.85");
    }
  });
  it("does NOT render the score-baseline dashed line (volume-axis chart, not score-axis)", () => {
    mockApis(fleetActivity([mkEntry({ riskTier: "critical", riskScore: 80 })]), {
      current: 80,
      baselineP50: 40,
      delta: 40,
      critCount: 1,
      highCount: 0,
      totalElevated: 1,
    });
    const { container } = renderTile();
    expect(container.querySelector("[data-cl-fleet-risk-baseline-line]")).toBeNull();
  });
  it("does NOT render the score-baseline floating text label", () => {
    // The baseline text used to surface the 7d p50 score on the chart. With a
    // volume-axis chart, that label is meaningless — the hero footer copy
    // carries the score-baseline information textually now.
    mockApis(fleetActivity([]), {
      current: 0,
      baselineP50: 42,
      delta: -42,
      critCount: 0,
      highCount: 0,
      totalElevated: 0,
    });
    const { container } = renderTile();
    const texts = Array.from(container.querySelectorAll("svg text")).map(
      (t) => t.textContent?.trim() ?? "",
    );
    expect(texts).not.toContain("42");
  });
  it("does NOT render any clipPaths (geometric stacking — clip-based bands replaced by polygons)", () => {
    mockApis(fleetActivity([mkEntry({ riskTier: "high", riskScore: 60 })]), {
      current: 60,
      baselineP50: 40,
      delta: 20,
      critCount: 0,
      highCount: 1,
      totalElevated: 1,
    });
    const { container } = renderTile();
    expect(container.querySelector("clipPath#cl-frt-low-clip")).toBeNull();
    expect(container.querySelector("clipPath#cl-frt-high-clip")).toBeNull();
    expect(container.querySelector("clipPath#cl-frt-crit-clip")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// Empty-state affordance (volume-area spec §5)
// ─────────────────────────────────────────────────────────────

describe("FleetRiskTile sparkline — empty state", () => {
  it("renders the empty-state text when no decisions land in any bucket", () => {
    mockApis(fleetActivity([]), {
      current: 0,
      baselineP50: 0,
      delta: 0,
      critCount: 0,
      highCount: 0,
      totalElevated: 0,
    });
    const { container } = renderTile();
    const empty = container.querySelector("[data-cl-fleet-risk-empty]");
    expect(empty).not.toBeNull();
    expect(empty?.textContent?.toLowerCase()).toContain("no fleet activity");
  });
  it("does NOT render the stacked fill polygons in empty state", () => {
    mockApis(fleetActivity([]), {
      current: 0,
      baselineP50: 0,
      delta: 0,
      critCount: 0,
      highCount: 0,
      totalElevated: 0,
    });
    const { container } = renderTile();
    expect(container.querySelectorAll("path[data-cl-fleet-risk-sparkline]").length).toBe(0);
    expect(container.querySelectorAll("path[data-cl-fleet-risk-sparkline-line]").length).toBe(0);
  });
  it("does NOT render the NOW dot in empty state", () => {
    mockApis(fleetActivity([]), {
      current: 0,
      baselineP50: 0,
      delta: 0,
      critCount: 0,
      highCount: 0,
      totalElevated: 0,
    });
    const { container } = renderTile({ selectedDate: null });
    expect(container.querySelector("[data-cl-fleet-risk-now-dot]")).toBeNull();
  });
  it("includes the rangeLabel in the empty-state text", () => {
    mockApis(fleetActivity([]), {
      current: 0,
      baselineP50: 0,
      delta: 0,
      critCount: 0,
      highCount: 0,
      totalElevated: 0,
    });
    const { container } = renderTile({ range: "7d" });
    const empty = container.querySelector("[data-cl-fleet-risk-empty]");
    expect(empty?.textContent?.toLowerCase()).toContain("7d");
  });
});

// ─────────────────────────────────────────────────────────────
// NOW dot on sparkline (polish-3 #3)
// ─────────────────────────────────────────────────────────────

describe("FleetRiskTile sparkline — NOW dot (top-of-stack, worst-present-tier)", () => {
  it("renders a NOW dot on today view when the last bucket has any classified decisions", () => {
    mockApis(fleetActivity([mkEntry({ riskTier: "high", riskScore: 60 })]), {
      current: 60,
      baselineP50: 40,
      delta: 20,
      critCount: 0,
      highCount: 1,
      totalElevated: 1,
    });
    const { container } = renderTile({ selectedDate: null });
    const dot = container.querySelector("[data-cl-fleet-risk-now-dot]");
    expect(dot).not.toBeNull();
    expect(dot?.tagName.toLowerCase()).toBe("circle");
  });
  it("does NOT render the NOW dot on past-day views", () => {
    mockApis(fleetActivity([mkEntry({ riskTier: "high", riskScore: 60 })]), {
      current: 60,
      baselineP50: 40,
      delta: 20,
      critCount: 0,
      highCount: 1,
      totalElevated: 1,
    });
    const { container } = renderTile({ selectedDate: "2026-04-01" });
    expect(container.querySelector("[data-cl-fleet-risk-now-dot]")).toBeNull();
  });
  it("colors NOW dot red when the last bucket has any critical entries", () => {
    mockApis(fleetActivity([mkEntry({ riskTier: "critical", riskScore: 90 })]), {
      current: 90,
      baselineP50: 40,
      delta: 50,
      critCount: 1,
      highCount: 0,
      totalElevated: 1,
    });
    const { container } = renderTile({ selectedDate: null });
    const dot = container.querySelector<SVGCircleElement>("[data-cl-fleet-risk-now-dot]");
    expect(dot?.getAttribute("fill")).toMatch(/cl-risk-critical/);
  });
  it("colors NOW dot salmon (--cl-risk-high) when the last bucket has high but no critical", () => {
    // Salmon, NOT amber. Worst-present-tier of {low:0, medium:0, high:1, critical:0} is high.
    mockApis(fleetActivity([mkEntry({ riskTier: "high", riskScore: 60 })]), {
      current: 60,
      baselineP50: 40,
      delta: 20,
      critCount: 0,
      highCount: 1,
      totalElevated: 1,
    });
    const { container } = renderTile({ selectedDate: null });
    const dot = container.querySelector<SVGCircleElement>("[data-cl-fleet-risk-now-dot]");
    expect(dot?.getAttribute("fill")).toMatch(/cl-risk-high/);
    expect(dot?.getAttribute("fill")).not.toMatch(/cl-risk-medium/);
  });
  it("colors NOW dot amber (--cl-risk-medium) when the last bucket has medium but no high/critical", () => {
    mockApis(fleetActivity([mkEntry({ riskTier: "medium", riskScore: 30 })]), {
      current: 30,
      baselineP50: 40,
      delta: -10,
      critCount: 0,
      highCount: 0,
      totalElevated: 0,
    });
    const { container } = renderTile({ selectedDate: null });
    const dot = container.querySelector<SVGCircleElement>("[data-cl-fleet-risk-now-dot]");
    expect(dot?.getAttribute("fill")).toMatch(/cl-risk-medium/);
  });
  it("colors NOW dot green (--cl-risk-low) when the last bucket has only low entries", () => {
    mockApis(fleetActivity([mkEntry({ riskTier: "low", riskScore: 10 })]), {
      current: 10,
      baselineP50: 40,
      delta: -30,
      critCount: 0,
      highCount: 0,
      totalElevated: 0,
    });
    const { container } = renderTile({ selectedDate: null });
    const dot = container.querySelector<SVGCircleElement>("[data-cl-fleet-risk-now-dot]");
    expect(dot?.getAttribute("fill")).toMatch(/cl-risk-low/);
  });
  it("positions NOW dot at the top of the stack (cy = yForCount(last.total))", () => {
    // Only one bucket has a decision (in the last bucket). maxVolume floor is 5
    // (Math.max(5, ...buckets.map(b => b.total)) — see render call site).
    // last.total = 1 → cy = SPARK_H * (1 - 1/5) = 100 * 0.8 = 80.
    mockApis(fleetActivity([mkEntry({ riskTier: "critical", riskScore: 90 })]), {
      current: 90,
      baselineP50: 40,
      delta: 50,
      critCount: 1,
      highCount: 0,
      totalElevated: 1,
    });
    const { container } = renderTile({ selectedDate: null });
    const dot = container.querySelector<SVGCircleElement>("[data-cl-fleet-risk-now-dot]");
    expect(dot?.getAttribute("cy")).toBe("80");
  });
  it("has a bg-colored stroke (knockout halo) so it reads over the fill", () => {
    mockApis(fleetActivity([mkEntry({ riskTier: "high", riskScore: 60 })]), {
      current: 60,
      baselineP50: 40,
      delta: 20,
      critCount: 0,
      highCount: 1,
      totalElevated: 1,
    });
    const { container } = renderTile({ selectedDate: null });
    const dot = container.querySelector<SVGCircleElement>("[data-cl-fleet-risk-now-dot]");
    expect(dot?.getAttribute("stroke")).toMatch(/cl-bg/);
    expect(dot?.getAttribute("stroke-width")).toBe("2");
  });
});

// ─────────────────────────────────────────────────────────────
// Per-bucket hover tooltip (volume-area spec §6)
// ─────────────────────────────────────────────────────────────

describe("FleetRiskTile sparkline — per-bucket hover tooltip", () => {
  it("renders one invisible hover rect per bucket (24 for non-7d ranges)", () => {
    mockApis(fleetActivity([mkEntry({ riskTier: "high", riskScore: 60 })]), {
      current: 60,
      baselineP50: 40,
      delta: 20,
      critCount: 0,
      highCount: 1,
      totalElevated: 1,
    });
    const { container } = renderTile({ range: "24h" });
    const rects = container.querySelectorAll("[data-cl-fleet-risk-bucket-hover]");
    expect(rects.length).toBe(24);
  });
  it("opens a tooltip on mouseenter with all 4 tier rows visible (structural readability)", () => {
    mockApis(fleetActivity([mkEntry({ riskTier: "critical", riskScore: 90 })]), {
      current: 90,
      baselineP50: 40,
      delta: 50,
      critCount: 1,
      highCount: 0,
      totalElevated: 1,
    });
    const { container } = renderTile();
    const rects = container.querySelectorAll("[data-cl-fleet-risk-bucket-hover]");
    expect(rects.length).toBeGreaterThan(0);
    fireEvent.mouseEnter(rects[rects.length - 1] as Element);
    const tooltip = container.querySelector("[data-cl-fleet-risk-bucket-tooltip]");
    expect(tooltip).not.toBeNull();
    const text = tooltip?.textContent ?? "";
    // All 4 tier rows render — even when zero — so the breakdown reads structurally.
    expect(text.toLowerCase()).toContain("crit");
    expect(text.toLowerCase()).toContain("high");
    expect(text.toLowerCase()).toContain("medium");
    expect(text.toLowerCase()).toContain("low");
  });
  it("tooltip surfaces the per-tier counts for the hovered bucket", () => {
    mockApis(
      fleetActivity([
        mkEntry({ riskTier: "critical", riskScore: 90 }),
        mkEntry({ riskTier: "high", riskScore: 60 }),
        mkEntry({ riskTier: "high", riskScore: 60 }),
      ]),
      {
        current: 90,
        baselineP50: 40,
        delta: 50,
        critCount: 1,
        highCount: 2,
        totalElevated: 3,
      },
    );
    const { container } = renderTile();
    const rects = Array.from(container.querySelectorAll("[data-cl-fleet-risk-bucket-hover]"));
    fireEvent.mouseEnter(rects[rects.length - 1] as Element);
    const tooltip = container.querySelector("[data-cl-fleet-risk-bucket-tooltip]");
    expect(tooltip).not.toBeNull();
    const text = tooltip?.textContent ?? "";
    // Total + per-tier counts (1 critical, 2 high, 0 medium, 0 low).
    expect(text).toContain("3");
    expect(text).toMatch(/1\s*crit/i);
    expect(text).toMatch(/2\s*high/i);
  });
  it("closes the tooltip on mouseleave", () => {
    mockApis(fleetActivity([mkEntry({ riskTier: "critical", riskScore: 90 })]), {
      current: 90,
      baselineP50: 40,
      delta: 50,
      critCount: 1,
      highCount: 0,
      totalElevated: 1,
    });
    const { container } = renderTile();
    const rects = container.querySelectorAll("[data-cl-fleet-risk-bucket-hover]");
    const last = rects[rects.length - 1] as Element;
    fireEvent.mouseEnter(last);
    expect(container.querySelector("[data-cl-fleet-risk-bucket-tooltip]")).not.toBeNull();
    fireEvent.mouseLeave(last);
    expect(container.querySelector("[data-cl-fleet-risk-bucket-tooltip]")).toBeNull();
  });
  it("does NOT render bucket hover overlays in empty state", () => {
    // When all buckets are zero, the chart shows the empty-state text — the
    // hover overlay would be misleading there.
    mockApis(fleetActivity([]), {
      current: 0,
      baselineP50: 0,
      delta: 0,
      critCount: 0,
      highCount: 0,
      totalElevated: 0,
    });
    const { container } = renderTile();
    expect(container.querySelectorAll("[data-cl-fleet-risk-bucket-hover]").length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// Hero footer copy (volume-area spec §7)
// ─────────────────────────────────────────────────────────────

describe("FleetRiskTile hero footer copy", () => {
  it("includes 'p50 score' (disambiguates score-axis hero from volume-axis chart)", () => {
    mockApis(fleetActivity([]), {
      current: 0,
      baselineP50: 40,
      delta: -40,
      critCount: 0,
      highCount: 0,
      totalElevated: 0,
    });
    const { container } = renderTile();
    const text = container.querySelector("[data-cl-fleet-risk-hero]")?.textContent ?? "";
    expect(text.toLowerCase()).toContain("p50 score over last 7 days");
  });
});

// ─────────────────────────────────────────────────────────────
// Tape (spec §6.4)
// ─────────────────────────────────────────────────────────────

describe("FleetRiskTile tape", () => {
  it("plots a ringed crit dot for score >= 75", () => {
    mockApis(fleetActivity([mkEntry({ riskScore: 80, toolCallId: "crit-1" })]), {
      current: 80,
      baselineP50: 40,
      delta: 40,
      critCount: 1,
      highCount: 0,
      totalElevated: 1,
    });
    const { container } = renderTile();
    const crit = container.querySelector('[data-cl-fleet-risk-tape-dot="crit-1"]');
    expect(crit).not.toBeNull();
    expect(crit?.getAttribute("data-cl-tier")).toBe("critical");
  });
  it("plots a filled high dot for 50 <= score < 75", () => {
    mockApis(fleetActivity([mkEntry({ riskScore: 60, toolCallId: "hi-1" })]), {
      current: 60,
      baselineP50: 30,
      delta: 30,
      critCount: 0,
      highCount: 1,
      totalElevated: 1,
    });
    const { container } = renderTile();
    const hi = container.querySelector('[data-cl-fleet-risk-tape-dot="hi-1"]');
    expect(hi).not.toBeNull();
    expect(hi?.getAttribute("data-cl-tier")).toBe("high");
  });
  it("does NOT plot events below 50", () => {
    mockApis(fleetActivity([mkEntry({ riskScore: 30, toolCallId: "lo-1" })]), {
      current: 30,
      baselineP50: 0,
      delta: 30,
      critCount: 0,
      highCount: 0,
      totalElevated: 0,
    });
    const { container } = renderTile();
    expect(container.querySelector('[data-cl-fleet-risk-tape-dot="lo-1"]')).toBeNull();
  });
  it("hover on a tape dot surfaces a tooltip containing the tool namespace", () => {
    mockApis(
      fleetActivity([
        mkEntry({
          toolName: "exec",
          params: { command: "git status" },
          riskScore: 80,
          toolCallId: "tc-hover",
          agentId: "alpha",
        }),
      ]),
      {
        current: 80,
        baselineP50: 40,
        delta: 40,
        critCount: 1,
        highCount: 0,
        totalElevated: 1,
      },
    );
    const { container } = renderTile();
    const dot = container.querySelector('[data-cl-fleet-risk-tape-dot="tc-hover"]');
    expect(dot).not.toBeNull();
    fireEvent.mouseEnter(dot as Element);
    const tooltip = container.querySelector("[data-cl-risk-tooltip]");
    expect(tooltip).not.toBeNull();
    // Polish §5 — tooltip format: {agent} · {namespace} on line 1, score + time on line 2.
    const text = tooltip?.textContent ?? "";
    expect(text).toContain("shell.git");
    expect(text).toContain("alpha");
    expect(text).toContain("80");
  });
  it("tooltip is a <foreignObject> with pointer-events: none (polish §5.4)", () => {
    mockApis(
      fleetActivity([
        mkEntry({
          toolName: "exec",
          params: { command: "git status" },
          riskScore: 80,
          toolCallId: "tc-fo",
          agentId: "alpha",
        }),
      ]),
      {
        current: 80,
        baselineP50: 40,
        delta: 40,
        critCount: 1,
        highCount: 0,
        totalElevated: 1,
      },
    );
    const { container } = renderTile();
    fireEvent.mouseEnter(
      container.querySelector('[data-cl-fleet-risk-tape-dot="tc-fo"]') as Element,
    );
    const tooltip = container.querySelector("[data-cl-risk-tooltip]");
    expect(tooltip).not.toBeNull();
    // Must be a foreignObject — SVG element namespace, tag lowercase in DOM.
    expect(tooltip?.tagName.toLowerCase()).toBe("foreignobject");
    // pointer-events: none, to avoid hover-flicker when the tooltip overlaps
    // the dot beneath it.
    const pe = (tooltip as SVGElement).style.pointerEvents;
    expect(pe).toBe("none");
  });
  it("tooltip x-coordinate clamps when the dot is near the right edge (no clipping at NOW)", () => {
    // Entry timestamp extremely close to NOW so the tape dot lands at the
    // right edge of the plot. clampTooltipX must pull the tooltip back so
    // its left edge stays inside the SVG.
    mockApis(
      fleetActivity([
        mkEntry({
          timestamp: new Date(NOW_MS - 1_000).toISOString(),
          riskScore: 80,
          toolCallId: "tc-edge",
        }),
      ]),
      {
        current: 80,
        baselineP50: 40,
        delta: 40,
        critCount: 1,
        highCount: 0,
        totalElevated: 1,
      },
    );
    const { container } = renderTile();
    fireEvent.mouseEnter(
      container.querySelector('[data-cl-fleet-risk-tape-dot="tc-edge"]') as Element,
    );
    const tooltip = container.querySelector<SVGForeignObjectElement>("[data-cl-risk-tooltip]");
    expect(tooltip).not.toBeNull();
    const xAttr = Number(tooltip?.getAttribute("x"));
    const widthAttr = Number(tooltip?.getAttribute("width"));
    // x must be inside the SVG even though the dot is near the right edge.
    expect(xAttr).toBeGreaterThanOrEqual(0);
    // x + width must not exceed the SVG viewBox width (420 per polish spec §6.5).
    expect(xAttr + widthAttr).toBeLessThanOrEqual(420);
  });
});

// ─────────────────────────────────────────────────────────────
// NOW line (spec §6.4, §6.5)
// ─────────────────────────────────────────────────────────────

describe("FleetRiskTile NOW line", () => {
  it("renders exactly one NOW line at the SVG root (continuous across layers)", () => {
    mockApis(fleetActivity([mkEntry({ riskScore: 80 })]), {
      current: 80,
      baselineP50: 40,
      delta: 40,
      critCount: 1,
      highCount: 0,
      totalElevated: 1,
    });
    const { container } = renderTile();
    const nowLines = container.querySelectorAll("[data-cl-fleet-risk-now-line]");
    expect(nowLines.length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────
// Click-to-navigate (spec §6.6)
// ─────────────────────────────────────────────────────────────

describe("FleetRiskTile click handling", () => {
  it("navigates to /session/:sessionKey with highlightToolCallId when a tape dot is clicked", () => {
    mockApis(
      fleetActivity([
        mkEntry({
          riskScore: 80,
          toolCallId: "tc-click",
          sessionKey: "agent:a1:main:s77",
        }),
      ]),
      {
        current: 80,
        baselineP50: 40,
        delta: 40,
        critCount: 1,
        highCount: 0,
        totalElevated: 1,
      },
    );
    const { container } = renderTile();
    const dot = container.querySelector('[data-cl-fleet-risk-tape-dot="tc-click"]');
    expect(dot).not.toBeNull();
    fireEvent.click(dot as Element);
    expect(navigateSpy).toHaveBeenCalledWith("/session/agent%3Aa1%3Amain%3As77", {
      state: { highlightToolCallId: "tc-click" },
    });
  });
});

// ─────────────────────────────────────────────────────────────
// Legend footer (spec §6.7)
// ─────────────────────────────────────────────────────────────

describe("FleetRiskTile legend footer", () => {
  it("shows high + critical chips and the totalElevated count from the hero endpoint", () => {
    mockApis(fleetActivity([]), {
      current: 0,
      baselineP50: 0,
      delta: 0,
      critCount: 2,
      highCount: 3,
      totalElevated: 5,
    });
    const { container } = renderTile();
    const legend = container.querySelector("[data-cl-fleet-risk-legend]");
    expect(legend).not.toBeNull();
    const text = legend?.textContent ?? "";
    expect(text.toLowerCase()).toContain("high");
    expect(text.toLowerCase()).toContain("critical");
    expect(text).toContain("5");
    expect(text).toContain("today");
  });
});

// ─────────────────────────────────────────────────────────────
// Empty / edge states (spec §6.8, Case 1)
// ─────────────────────────────────────────────────────────────

describe("FleetRiskTile empty + loading states", () => {
  it('renders the hero with "0" and no tape dots when there are no events', () => {
    mockApis(fleetActivity([]), {
      current: 0,
      baselineP50: 0,
      delta: 0,
      critCount: 0,
      highCount: 0,
      totalElevated: 0,
    });
    const { container } = renderTile();
    const current = container.querySelector("[data-cl-fleet-risk-current]");
    expect(current?.textContent).toBe("0");
    expect(container.querySelectorAll("[data-cl-fleet-risk-tape-dot]").length).toBe(0);
  });
  it("renders a loading skeleton when both endpoints are still pending (hooks still run unconditionally)", () => {
    mockedUseApi.mockReturnValue({
      data: null,
      loading: true,
      error: null,
      refetch: vi.fn(),
    });
    const { container } = renderTile();
    // The tile still mounts something visible (doesn't crash / return null) so
    // the grid cell has presence during the first paint.
    expect(container.querySelector("[data-cl-fleet-risk-tile]")).not.toBeNull();
  });
});
