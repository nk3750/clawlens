// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import RiskMixTierRows, {
  MIN_FLOOR_PCT,
} from "../dashboard/src/components/fleetheader/RiskMixTierRows";

/**
 * stat-cards-revamp-spec §4.1 + §6.1 — Risk Mix card replaced with a list of
 * full-width tier rows, each row a `<button>` that filters /activity. Synthetic
 * data only; do NOT lift any pixel values from the design mock.
 */

let lastLocation: { pathname: string; search: string } = { pathname: "/", search: "" };

function LocationProbe() {
  const loc = useLocation();
  lastLocation = { pathname: loc.pathname, search: loc.search };
  return null;
}

function renderRows(props: ComponentProps<typeof RiskMixTierRows>) {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <RiskMixTierRows {...props} />
      <LocationProbe />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  lastLocation = { pathname: "/", search: "" };
});

// Helpers ──────────────────────────────────────────────────────────

function rowsInOrder(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-cl-tier-row]"));
}

function tierOf(row: HTMLElement): string | null {
  return row.getAttribute("data-cl-tier");
}

function fillWidthPctOf(row: HTMLElement): number {
  const fill = row.querySelector<HTMLElement>("[data-cl-bar-fill]");
  if (!fill) return 0;
  // Inline width is set as `${pct}%` so we can read it directly.
  const w = fill.style.width;
  if (!w.endsWith("%")) return 0;
  return Number.parseFloat(w);
}

function countTextOf(row: HTMLElement): string {
  return row.querySelector("[data-cl-count]")?.textContent ?? "";
}

// ── Tests ─────────────────────────────────────────────────────────

describe("RiskMixTierRows — row order", () => {
  it("renders exactly four tier rows in severity-down order", () => {
    renderRows({ breakdown: { critical: 3, high: 9, medium: 38, low: 142 } });
    const rows = rowsInOrder();
    expect(rows.length).toBe(4);
    expect(rows.map(tierOf)).toEqual(["critical", "high", "medium", "low"]);
  });
});

describe("RiskMixTierRows — header total", () => {
  it("renders header total = sum of breakdown", () => {
    renderRows({ breakdown: { critical: 3, high: 9, medium: 38, low: 142 } });
    const header = document.querySelector<HTMLElement>("[data-cl-risk-mix-header-total]");
    expect(header?.textContent).toBe("192 actions");
  });

  it("renders '0 actions' header when all counts are zero (preserve numeric rhythm)", () => {
    renderRows({ breakdown: { critical: 0, high: 0, medium: 0, low: 0 } });
    const header = document.querySelector<HTMLElement>("[data-cl-risk-mix-header-total]");
    expect(header?.textContent).toBe("0 actions");
  });

  it("uses the explicit `total` prop as denominator when provided", () => {
    renderRows({
      breakdown: { critical: 10, high: 0, medium: 0, low: 0 },
      total: 100,
    });
    const critRow = document.querySelector<HTMLElement>(
      '[data-cl-tier-row][data-cl-tier="critical"]',
    );
    expect(critRow).not.toBeNull();
    // 10/100 = 10%; floor is well below 10 so the value is honest.
    expect(fillWidthPctOf(critRow as HTMLElement)).toBeCloseTo(10, 5);
    // Count cell shows "10 · 10%".
    expect(countTextOf(critRow as HTMLElement)).toBe("10 · 10%");
  });
});

describe("RiskMixTierRows — empty state", () => {
  it("renders count '0' with no percent suffix when all counts are zero", () => {
    renderRows({ breakdown: { critical: 0, high: 0, medium: 0, low: 0 } });
    const rows = rowsInOrder();
    expect(rows.length).toBe(4);
    for (const row of rows) {
      expect(countTextOf(row)).toBe("0");
    }
  });

  it("renders no bar fills when all counts are zero", () => {
    renderRows({ breakdown: { critical: 0, high: 0, medium: 0, low: 0 } });
    const fills = document.querySelectorAll("[data-cl-bar-fill]");
    expect(fills.length).toBe(0);
  });
});

describe("RiskMixTierRows — bar width formula", () => {
  it("computes bar width as max(MIN_FLOOR_PCT, n/T*100) for non-zero counts", () => {
    // All four non-zero, evenly weighted at 25% — well above any reasonable floor.
    renderRows({ breakdown: { critical: 25, high: 25, medium: 25, low: 25 } });
    const rows = rowsInOrder();
    const T = 100;
    for (const row of rows) {
      const tier = tierOf(row);
      const expected = Math.max(MIN_FLOOR_PCT, (25 / T) * 100);
      expect(fillWidthPctOf(row)).toBeCloseTo(expected, 5);
      expect(tier).not.toBeNull();
    }
  });

  it("hoists tiny minorities up to MIN_FLOOR_PCT (n=1, T=10000)", () => {
    renderRows({ breakdown: { critical: 1, high: 0, medium: 0, low: 9999 } });
    const critRow = document.querySelector<HTMLElement>(
      '[data-cl-tier-row][data-cl-tier="critical"]',
    );
    expect(critRow).not.toBeNull();
    // Raw share is 0.01% — bar must clamp to floor so the row reads.
    expect(fillWidthPctOf(critRow as HTMLElement)).toBe(MIN_FLOOR_PCT);
  });

  it("renders a 100% bar when a single tier holds all the actions", () => {
    renderRows({ breakdown: { critical: 0, high: 0, medium: 0, low: 50 } });
    const lowRow = document.querySelector<HTMLElement>('[data-cl-tier-row][data-cl-tier="low"]');
    expect(lowRow).not.toBeNull();
    expect(fillWidthPctOf(lowRow as HTMLElement)).toBe(100);
    // Other tiers have no fill.
    for (const tier of ["critical", "high", "medium"] as const) {
      const row = document.querySelector<HTMLElement>(`[data-cl-tier-row][data-cl-tier="${tier}"]`);
      expect(row).not.toBeNull();
      expect(fillWidthPctOf(row as HTMLElement)).toBe(0);
    }
  });
});

describe("RiskMixTierRows — count + percent format", () => {
  it("renders '{count} · {pct}%' for standard non-zero counts", () => {
    // 38 / 192 ≈ 19.79% → rounds to 20.
    renderRows({ breakdown: { critical: 3, high: 9, medium: 38, low: 142 } });
    const medRow = document.querySelector<HTMLElement>('[data-cl-tier-row][data-cl-tier="medium"]');
    expect(countTextOf(medRow as HTMLElement)).toBe("38 · 20%");
  });

  it("renders '<1%' when share is positive but rounds to zero", () => {
    // 1 / 10000 = 0.01% → Math.round = 0; spec calls for "<1%".
    renderRows({ breakdown: { critical: 1, high: 0, medium: 0, low: 9999 } });
    const critRow = document.querySelector<HTMLElement>(
      '[data-cl-tier-row][data-cl-tier="critical"]',
    );
    expect(countTextOf(critRow as HTMLElement)).toBe("1 · <1%");
  });

  it("renders '100%' when one tier holds the whole denominator", () => {
    renderRows({ breakdown: { critical: 0, high: 0, medium: 0, low: 50 } });
    const lowRow = document.querySelector<HTMLElement>('[data-cl-tier-row][data-cl-tier="low"]');
    expect(countTextOf(lowRow as HTMLElement)).toBe("50 · 100%");
  });

  it("renders only the count (no percent suffix) when T === 0", () => {
    renderRows({ breakdown: { critical: 0, high: 0, medium: 0, low: 0 } });
    for (const tier of ["critical", "high", "medium", "low"] as const) {
      const row = document.querySelector<HTMLElement>(`[data-cl-tier-row][data-cl-tier="${tier}"]`);
      expect(countTextOf(row as HTMLElement)).toBe("0");
    }
  });
});

describe("RiskMixTierRows — click + keyboard navigation", () => {
  it("navigates to /activity?tier={tier} when a row is clicked", async () => {
    const user = userEvent.setup();
    renderRows({ breakdown: { critical: 3, high: 9, medium: 38, low: 142 } });

    for (const tier of ["critical", "high", "medium", "low"] as const) {
      const row = document.querySelector(
        `[data-cl-tier-row][data-cl-tier="${tier}"]`,
      ) as HTMLElement | null;
      expect(row).not.toBeNull();
      await user.click(row as HTMLElement);
      expect(lastLocation.pathname).toBe("/activity");
      expect(lastLocation.search).toContain(`tier=${tier}`);
    }
  });

  it("triggers navigation via Enter key", async () => {
    const user = userEvent.setup();
    renderRows({ breakdown: { critical: 3, high: 9, medium: 38, low: 142 } });

    const highRow = document.querySelector(
      '[data-cl-tier-row][data-cl-tier="high"]',
    ) as HTMLElement | null;
    expect(highRow).not.toBeNull();
    (highRow as HTMLElement).focus();
    await user.keyboard("{Enter}");
    expect(lastLocation.pathname).toBe("/activity");
    expect(lastLocation.search).toContain("tier=high");
  });

  it("triggers navigation via Space key", async () => {
    const user = userEvent.setup();
    renderRows({ breakdown: { critical: 3, high: 9, medium: 38, low: 142 } });

    const medRow = document.querySelector(
      '[data-cl-tier-row][data-cl-tier="medium"]',
    ) as HTMLElement | null;
    expect(medRow).not.toBeNull();
    (medRow as HTMLElement).focus();
    await user.keyboard(" ");
    expect(lastLocation.pathname).toBe("/activity");
    expect(lastLocation.search).toContain("tier=medium");
  });
});

describe("RiskMixTierRows — a11y", () => {
  it("renders four <button> rows reachable by keyboard", () => {
    renderRows({ breakdown: { critical: 3, high: 9, medium: 38, low: 142 } });
    const buttons = screen.getAllByRole("button");
    // Component owns its own card; only the 4 row buttons exist within.
    expect(buttons.length).toBe(4);
  });

  it("exposes an accessible name including count and tier label per row", () => {
    renderRows({ breakdown: { critical: 3, high: 9, medium: 38, low: 142 } });

    const expectations: Array<[string, RegExp]> = [
      ["critical", /3.*CRIT.*filter activity/i],
      ["high", /9.*HIGH.*filter activity/i],
      ["medium", /38.*MED.*filter activity/i],
      ["low", /142.*LOW.*filter activity/i],
    ];

    for (const [tier, re] of expectations) {
      const row = document.querySelector(
        `[data-cl-tier-row][data-cl-tier="${tier}"]`,
      ) as HTMLElement | null;
      expect(row).not.toBeNull();
      const label = (row as HTMLElement).getAttribute("aria-label") ?? "";
      expect(label).toMatch(re);
    }
  });
});
