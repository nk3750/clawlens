// @vitest-environment jsdom

import { fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import RiskMixPopover from "../dashboard/src/components/RiskMixPopover";
import type { RiskTier } from "../dashboard/src/lib/types";

function mix(partial: Partial<Record<RiskTier, number>>): Record<RiskTier, number> {
  return { low: 0, medium: 0, high: 0, critical: 0, ...partial };
}

function renderPop(
  props: Partial<{
    mix: Record<RiskTier, number>;
    total: number;
    agentId: string;
  }> = {},
) {
  const full = {
    mix: props.mix ?? mix({ low: 10 }),
    total: props.total,
    agentId: props.agentId ?? "alpha",
  };
  return render(
    <MemoryRouter>
      <RiskMixPopover {...full} />
    </MemoryRouter>,
  );
}

function queryRows(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-cl-risk-mix-pop-row]"));
}

describe("RiskMixPopover — per-tier rows", () => {
  it("renders one row per present tier in draw order (low → crit)", () => {
    const { container } = renderPop({
      mix: mix({ low: 4, medium: 11, high: 7, critical: 2 }),
    });
    const rows = queryRows(container);
    expect(rows).toHaveLength(4);
    expect(rows[0].getAttribute("data-cl-risk-mix-pop-row")).toBe("low");
    expect(rows[1].getAttribute("data-cl-risk-mix-pop-row")).toBe("medium");
    expect(rows[2].getAttribute("data-cl-risk-mix-pop-row")).toBe("high");
    expect(rows[3].getAttribute("data-cl-risk-mix-pop-row")).toBe("critical");
  });

  it("skips tiers with zero count", () => {
    const { container } = renderPop({ mix: mix({ low: 80, medium: 20 }) });
    const rows = queryRows(container);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.getAttribute("data-cl-risk-mix-pop-row"))).toEqual(["low", "medium"]);
  });

  it("each row includes pct%, tier name, and count", () => {
    // 4 low out of 24 scored → 17% (rounded). 11 medium → 46%.
    const { container } = renderPop({
      mix: mix({ low: 4, medium: 11, high: 7, critical: 2 }),
    });
    const rows = queryRows(container);
    const lowRow = rows[0];
    expect(lowRow.textContent ?? "").toContain("17%");
    expect(lowRow.textContent ?? "").toContain("low");
    expect(lowRow.textContent ?? "").toContain("4");

    const medRow = rows[1];
    expect(medRow.textContent ?? "").toContain("46%");
    expect(medRow.textContent ?? "").toContain("medium");
    expect(medRow.textContent ?? "").toContain("11");
  });

  it("uses `total` prop as denominator when provided", () => {
    // 10 low of 100 total → 10% (not 100% against sum-of-mix). Same
    // denominator rule as the bar's arc-length math.
    const { container } = renderPop({ mix: mix({ low: 10 }), total: 100 });
    const rows = queryRows(container);
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent ?? "").toContain("10%");
  });

  it("shows a color dot per row using the tier --cl-risk-* token", () => {
    const { container } = renderPop({
      mix: mix({ low: 1, medium: 1, high: 1, critical: 1 }),
    });
    const dots = Array.from(container.querySelectorAll<HTMLElement>("[data-cl-risk-mix-pop-dot]"));
    expect(dots).toHaveLength(4);
    expect(dots[0].style.backgroundColor).toMatch(/--cl-risk-low/);
    expect(dots[1].style.backgroundColor).toMatch(/--cl-risk-medium/);
    expect(dots[2].style.backgroundColor).toMatch(/--cl-risk-high/);
    expect(dots[3].style.backgroundColor).toMatch(/--cl-risk-critical/);
  });
});

describe("RiskMixPopover — header + narrative", () => {
  it("shows `Risk today · N scored actions` in the header using total when provided", () => {
    const { container } = renderPop({ mix: mix({ low: 10 }), total: 24 });
    const header = container.querySelector<HTMLElement>("[data-cl-risk-mix-pop-header]");
    expect(header?.textContent ?? "").toMatch(/Risk today/);
    expect(header?.textContent ?? "").toMatch(/24 scored actions/);
  });

  it("falls back to sum-of-mix when no total prop is given", () => {
    const { container } = renderPop({ mix: mix({ low: 3, medium: 2 }) });
    const header = container.querySelector<HTMLElement>("[data-cl-risk-mix-pop-header]");
    expect(header?.textContent ?? "").toMatch(/5 scored actions/);
  });

  it("renders the peak-tier narrative line colored by the peak tier", () => {
    const { container } = renderPop({
      mix: mix({ low: 4, medium: 11, critical: 2 }),
    });
    const narr = container.querySelector<HTMLElement>("[data-cl-risk-mix-pop-narrative]");
    expect(narr?.textContent ?? "").toContain("Peak tier today");
    expect(narr?.textContent ?? "").toContain("critical");
    expect(narr?.style.color).toMatch(/--cl-risk-critical/);
  });

  it("peak narrative picks the highest present tier when crit is absent", () => {
    const { container } = renderPop({ mix: mix({ low: 10, medium: 5, high: 2 }) });
    const narr = container.querySelector<HTMLElement>("[data-cl-risk-mix-pop-narrative]");
    expect(narr?.textContent ?? "").toContain("high");
    expect(narr?.style.color).toMatch(/--cl-risk-high/);
  });
});

describe("RiskMixPopover — click-through drill", () => {
  it("renders a link to /activity?agent=<id>&tier=<worstPresentTier>", () => {
    const { container } = renderPop({
      agentId: "seo-growth",
      mix: mix({ low: 10, medium: 5, high: 1 }),
    });
    const link = container.querySelector<HTMLAnchorElement>("[data-cl-risk-mix-pop-link]");
    expect(link).not.toBeNull();
    const href = link?.getAttribute("href") ?? "";
    expect(href).toContain("/activity");
    expect(href).toContain("agent=seo-growth");
    expect(href).toContain("tier=high");
  });

  it("worst-tier picks critical when any crit is present", () => {
    const { container } = renderPop({
      agentId: "baddie",
      mix: mix({ low: 4, medium: 11, high: 7, critical: 2 }),
    });
    const link = container.querySelector<HTMLAnchorElement>("[data-cl-risk-mix-pop-link]");
    expect(link?.getAttribute("href") ?? "").toContain("tier=critical");
  });

  it("URL-encodes agentIds with special characters", () => {
    const { container } = renderPop({
      agentId: "agent/with spaces",
      mix: mix({ low: 1 }),
    });
    const link = container.querySelector<HTMLAnchorElement>("[data-cl-risk-mix-pop-link]");
    const href = link?.getAttribute("href") ?? "";
    expect(href).toContain("agent=agent%2Fwith%20spaces");
  });

  it("stops propagation on click so the wrapping card Link doesn't also fire", () => {
    // Simulate the card-level outer <Link> click handler by attaching a listener
    // at a parent element; confirm that clicking the popover link does NOT
    // bubble to the parent. This is the guard the card relies on — without it,
    // users would get navigated to /agent/:id instead of /activity?tier=....
    const outerHandler = vi.fn();
    const { container } = render(
      <MemoryRouter>
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: test-only click spy */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: test-only click spy */}
        <div onClick={outerHandler}>
          <RiskMixPopover mix={mix({ low: 10, critical: 1 })} total={11} agentId="alpha" />
        </div>
      </MemoryRouter>,
    );
    const link = container.querySelector<HTMLAnchorElement>("[data-cl-risk-mix-pop-link]");
    fireEvent.click(link!);
    expect(outerHandler).not.toHaveBeenCalled();
  });
});

describe("RiskMixPopover — empty / degenerate", () => {
  it("returns null (renders nothing) when denominator is 0", () => {
    const { container } = renderPop({ mix: mix({}) });
    expect(container.firstChild).toBeNull();
  });
});
