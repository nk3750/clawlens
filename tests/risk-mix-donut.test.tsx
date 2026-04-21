// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import RiskMixDonut from "../dashboard/src/components/fleetheader/RiskMixDonut";

/**
 * homepage-linear-pivot-spec §B4b — risk-mix donut.
 *
 * Covers the three behaviours the prompt calls out:
 *   - render 4 SVG arc elements (one per tier)
 *   - arc dash-array lengths proportional to each tier's share
 *   - legend row counts + tier colours
 * Plus the empty-state fallback (total === 0 collapses to an outline ring)
 * and the click → /activity?tier={tier} wiring.
 */

let lastLocation: { pathname: string; search: string } = { pathname: "/", search: "" };

function LocationProbe() {
  const loc = useLocation();
  lastLocation = { pathname: loc.pathname, search: loc.search };
  return null;
}

function renderDonut(props: ComponentProps<typeof RiskMixDonut>) {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <RiskMixDonut {...props} />
      <LocationProbe />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  lastLocation = { pathname: "/", search: "" };
});

describe("RiskMixDonut — empty state", () => {
  it("renders an outline ring and no arc segments when all counts are zero", () => {
    renderDonut({ crit: 0, high: 0, medium: 0, low: 0 });

    const svg = document.querySelector("svg[data-cl-risk-mix-donut]");
    expect(svg).not.toBeNull();

    const arcs = svg?.querySelectorAll("circle[data-cl-arc]") ?? [];
    expect(arcs.length).toBe(0);

    const outline = svg?.querySelector("circle[data-cl-outline]");
    expect(outline).not.toBeNull();
  });

  it("still shows all four legend rows with zero counts", () => {
    renderDonut({ crit: 0, high: 0, medium: 0, low: 0 });

    for (const tier of ["critical", "high", "medium", "low"] as const) {
      const row = document.querySelector(`[data-cl-risk-mix-legend-row][data-cl-tier="${tier}"]`);
      expect(row).not.toBeNull();
      const countEl = row?.querySelector("[data-cl-count]");
      expect(countEl?.textContent).toBe("0");
    }
  });
});

describe("RiskMixDonut — arc geometry", () => {
  it("renders exactly four arc circles, one per tier", () => {
    renderDonut({ crit: 3, high: 9, medium: 38, low: 142 });

    const svg = document.querySelector("svg[data-cl-risk-mix-donut]");
    const arcs = Array.from(svg?.querySelectorAll("circle[data-cl-arc]") ?? []);
    expect(arcs.length).toBe(4);

    const tiers = arcs.map((a) => a.getAttribute("data-cl-tier")).sort();
    expect(tiers).toEqual(["critical", "high", "low", "medium"]);
  });

  it("sets each arc's stroke-dasharray length proportional to count / total", () => {
    renderDonut({ crit: 3, high: 9, medium: 38, low: 142 });

    const svg = document.querySelector("svg[data-cl-risk-mix-donut]");
    const segLen = (tier: string): number => {
      const arc = svg?.querySelector(`circle[data-cl-arc][data-cl-tier="${tier}"]`);
      const da = arc?.getAttribute("stroke-dasharray") ?? "";
      return Number.parseFloat(da.split(/\s+/)[0] ?? "0");
    };

    const lowLen = segLen("low");
    const medLen = segLen("medium");
    const highLen = segLen("high");
    const critLen = segLen("critical");

    expect(lowLen).toBeGreaterThan(medLen);
    expect(medLen).toBeGreaterThan(highLen);
    expect(highLen).toBeGreaterThan(critLen);
    expect(critLen).toBeGreaterThan(0);

    // low : medium ratio ≈ 142 / 38 ≈ 3.74 — tolerate the 2° gap subtraction.
    expect(lowLen / medLen).toBeGreaterThan(3);
    expect(lowLen / medLen).toBeLessThan(5);
  });

  it("respects an explicit total prop when larger than the sum", () => {
    // When a caller scopes the donut to a range whose denominator is known but
    // larger than the visible counts, the arcs must render against the provided
    // total — not the sum. Same crit=10 with total=100 must render ~10% of the
    // circumference, not 100%.
    const { unmount: unmount1 } = renderDonut({ crit: 10, high: 0, medium: 0, low: 0 });
    const svg1 = document.querySelector("svg[data-cl-risk-mix-donut]");
    const da1 =
      svg1
        ?.querySelector('circle[data-cl-arc][data-cl-tier="critical"]')
        ?.getAttribute("stroke-dasharray") ?? "";
    const noTotalLen = Number.parseFloat(da1.split(/\s+/)[0] ?? "0");
    unmount1();

    renderDonut({ crit: 10, high: 0, medium: 0, low: 0, total: 100 });
    const svg2 = document.querySelector("svg[data-cl-risk-mix-donut]");
    const da2 =
      svg2
        ?.querySelector('circle[data-cl-arc][data-cl-tier="critical"]')
        ?.getAttribute("stroke-dasharray") ?? "";
    const withTotalLen = Number.parseFloat(da2.split(/\s+/)[0] ?? "0");

    // Without total → full ring (crit == sum → 100%).
    // With total=100 → ~10% of the ring.
    expect(noTotalLen).toBeGreaterThan(withTotalLen * 5);
  });
});

describe("RiskMixDonut — legend", () => {
  it("renders four rows with the correct counts", () => {
    renderDonut({ crit: 3, high: 9, medium: 38, low: 142 });

    const legend = document.querySelector("[data-cl-risk-mix-legend]");
    expect(legend).not.toBeNull();

    const rows = legend?.querySelectorAll("[data-cl-risk-mix-legend-row]") ?? [];
    expect(rows.length).toBe(4);

    const countOf = (tier: string): string | null | undefined =>
      legend?.querySelector(`[data-cl-risk-mix-legend-row][data-cl-tier="${tier}"] [data-cl-count]`)
        ?.textContent;

    expect(countOf("critical")).toBe("3");
    expect(countOf("high")).toBe("9");
    expect(countOf("medium")).toBe("38");
    expect(countOf("low")).toBe("142");
  });

  it("applies the correct risk-tier colour to each legend dot", () => {
    renderDonut({ crit: 3, high: 9, medium: 38, low: 142 });

    const dotFor = (tier: string): HTMLElement | null =>
      document.querySelector(
        `[data-cl-risk-mix-legend-row][data-cl-tier="${tier}"] [data-cl-legend-dot]`,
      ) as HTMLElement | null;

    // jsdom's CSS parser strips `var(...)` from the `background` shorthand but
    // preserves it verbatim on the `background-color` longhand.
    expect(dotFor("critical")?.style.backgroundColor).toContain("--cl-risk-critical");
    expect(dotFor("high")?.style.backgroundColor).toContain("--cl-risk-high");
    expect(dotFor("medium")?.style.backgroundColor).toContain("--cl-risk-medium");
    expect(dotFor("low")?.style.backgroundColor).toContain("--cl-risk-low");
  });

  it("uses mono micro uppercase labels", () => {
    renderDonut({ crit: 3, high: 9, medium: 38, low: 142 });
    // Labels themselves come from the component; assert both shape + casing so
    // any future renaming (e.g. 'critical' → 'crit') still passes the uppercase
    // check while catching accidental title-casing.
    const labelFor = (tier: string): string =>
      (
        document.querySelector(
          `[data-cl-risk-mix-legend-row][data-cl-tier="${tier}"] [data-cl-legend-label]`,
        ) as HTMLElement | null
      )?.textContent ?? "";

    const critLabel = labelFor("critical");
    const highLabel = labelFor("high");
    const medLabel = labelFor("medium");
    const lowLabel = labelFor("low");

    expect(critLabel.length).toBeGreaterThan(0);
    expect(critLabel).toBe(critLabel.toUpperCase());
    expect(highLabel).toBe(highLabel.toUpperCase());
    expect(medLabel).toBe(medLabel.toUpperCase());
    expect(lowLabel).toBe(lowLabel.toUpperCase());
  });
});

describe("RiskMixDonut — click navigation", () => {
  it("navigates to /activity?tier={tier} when a legend row is clicked", async () => {
    const user = userEvent.setup();
    renderDonut({ crit: 3, high: 9, medium: 38, low: 142 });

    const highRow = document.querySelector(
      '[data-cl-risk-mix-legend-row][data-cl-tier="high"]',
    ) as HTMLElement | null;
    expect(highRow).not.toBeNull();

    await user.click(highRow as HTMLElement);

    expect(lastLocation.pathname).toBe("/activity");
    expect(lastLocation.search).toContain("tier=high");
  });

  it("navigates with the correct tier slug for each legend row", async () => {
    const user = userEvent.setup();
    renderDonut({ crit: 3, high: 9, medium: 38, low: 142 });

    for (const tier of ["critical", "high", "medium", "low"] as const) {
      const row = document.querySelector(
        `[data-cl-risk-mix-legend-row][data-cl-tier="${tier}"]`,
      ) as HTMLElement | null;
      expect(row).not.toBeNull();
      await user.click(row as HTMLElement);
      expect(lastLocation.pathname).toBe("/activity");
      expect(lastLocation.search).toContain(`tier=${tier}`);
    }
  });
});

describe("RiskMixDonut — a11y", () => {
  it("marks legend rows as buttons so they are keyboard reachable", () => {
    renderDonut({ crit: 3, high: 9, medium: 38, low: 142 });
    // screen.getAllByRole captures every legend row plus any additional buttons
    // the component adds (e.g. the donut itself if wrapped in a button). The
    // guarantee we need: at least one clickable role per legend row.
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(4);
  });
});
