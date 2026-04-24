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
  it('renders "0 vs 24h baseline" (no "+") when delta is exactly zero', () => {
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
    expect(delta?.textContent).toBe("0 vs 24h baseline");
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

describe("FleetRiskTile sparkline", () => {
  it("renders a stepped area path split into two tier clips (low + crit)", () => {
    mockApis(fleetActivity([mkEntry({ riskScore: 80 })]), {
      current: 80,
      baselineP50: 40,
      delta: 40,
      critCount: 1,
      highCount: 0,
      totalElevated: 1,
    });
    const { container } = renderTile();
    const paths = container.querySelectorAll("path[data-cl-fleet-risk-sparkline]");
    expect(paths.length).toBe(2);
  });
  it("renders critical threshold line + baseline line", () => {
    mockApis(fleetActivity([]), {
      current: 0,
      baselineP50: 40,
      delta: 0,
      critCount: 0,
      highCount: 0,
      totalElevated: 0,
    });
    const { container } = renderTile();
    expect(container.querySelector("[data-cl-fleet-risk-threshold-line]")).not.toBeNull();
    expect(container.querySelector("[data-cl-fleet-risk-baseline-line]")).not.toBeNull();
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
    // §6.6 — tooltip format: {agent} · {namespace} · {score} · {time}
    const text = tooltip?.textContent ?? "";
    expect(text).toContain("shell.git");
    expect(text).toContain("alpha");
    expect(text).toContain("80");
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
    expect(text).toContain("24h");
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
