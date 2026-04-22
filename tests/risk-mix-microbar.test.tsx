// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import RiskMixMicrobar from "../dashboard/src/components/RiskMixMicrobar";
import type { RiskTier } from "../dashboard/src/lib/types";

function mix(partial: Partial<Record<RiskTier, number>>): Record<RiskTier, number> {
  return { low: 0, medium: 0, high: 0, critical: 0, ...partial };
}

function queryBar(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>("[data-cl-risk-mix-microbar]");
}

function querySegs(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-cl-risk-mix-seg]"));
}

describe("RiskMixMicrobar — rendering", () => {
  it("renders four segments in severity order when every tier is present", () => {
    const { container } = render(
      <RiskMixMicrobar mix={mix({ low: 10, medium: 10, high: 10, critical: 10 })} />,
    );
    const segs = querySegs(container);
    expect(segs).toHaveLength(4);
    // Draw order is low → crit so low anchors the left, crit the right.
    expect(segs[0].getAttribute("data-cl-risk-mix-seg")).toBe("low");
    expect(segs[1].getAttribute("data-cl-risk-mix-seg")).toBe("medium");
    expect(segs[2].getAttribute("data-cl-risk-mix-seg")).toBe("high");
    expect(segs[3].getAttribute("data-cl-risk-mix-seg")).toBe("critical");
    // Each quarter.
    for (const s of segs) {
      expect(s.style.width).toBe("25%");
    }
  });

  it("renders only the tiers that are present (skips zero-count)", () => {
    const { container } = render(<RiskMixMicrobar mix={mix({ low: 80, medium: 20 })} />);
    const segs = querySegs(container);
    expect(segs).toHaveLength(2);
    expect(segs[0].getAttribute("data-cl-risk-mix-seg")).toBe("low");
    expect(segs[1].getAttribute("data-cl-risk-mix-seg")).toBe("medium");
  });

  it("renders a single full-width segment for all-low agents", () => {
    // The common case — a healthy agent does 100% low-tier work. Ensures the
    // bar reads as solid green, not a truncated stub.
    const { container } = render(<RiskMixMicrobar mix={mix({ low: 234 })} />);
    const segs = querySegs(container);
    expect(segs).toHaveLength(1);
    expect(segs[0].getAttribute("data-cl-risk-mix-seg")).toBe("low");
    expect(segs[0].style.width).toBe("100%");
  });

  it("computes segment widths as share of sum when no total prop given", () => {
    const { container } = render(<RiskMixMicrobar mix={mix({ low: 90, medium: 5, high: 5 })} />);
    const segs = querySegs(container);
    expect(segs).toHaveLength(3);
    expect(segs[0].style.width).toBe("90%");
    expect(segs[1].style.width).toBe("5%");
    expect(segs[2].style.width).toBe("5%");
  });

  it("applies --cl-risk-* fills per tier", () => {
    const { container } = render(
      <RiskMixMicrobar mix={mix({ low: 1, medium: 1, high: 1, critical: 1 })} />,
    );
    const segs = querySegs(container);
    expect(segs[0].style.backgroundColor).toMatch(/--cl-risk-low/);
    expect(segs[1].style.backgroundColor).toMatch(/--cl-risk-medium/);
    expect(segs[2].style.backgroundColor).toMatch(/--cl-risk-high/);
    expect(segs[3].style.backgroundColor).toMatch(/--cl-risk-critical/);
  });
});

describe("RiskMixMicrobar — empty state", () => {
  it("returns null when sum is 0 and no total prop is given", () => {
    const { container } = render(<RiskMixMicrobar mix={mix({})} />);
    expect(queryBar(container)).toBeNull();
  });

  it("still renders (empty track) when total is provided even if mix is zero", () => {
    // total=12 with an all-zero mix means `12 actions today, none scored` —
    // the bar's track should still paint so the card layout stays stable.
    // No segments draw, but the container exists.
    const { container } = render(<RiskMixMicrobar mix={mix({})} total={12} />);
    const bar = queryBar(container);
    expect(bar).not.toBeNull();
    const segs = querySegs(container);
    expect(segs).toHaveLength(0);
  });
});

describe("RiskMixMicrobar — total override", () => {
  it("uses `total` as the denominator so widths are scaled by the canonical action count", () => {
    // 10 scored entries out of 100 today → low segment fills 10%, not 100%.
    // Keeps the bar's arc-length honest when some entries lack a risk score.
    const { container } = render(<RiskMixMicrobar mix={mix({ low: 10 })} total={100} />);
    const segs = querySegs(container);
    expect(segs).toHaveLength(1);
    expect(segs[0].style.width).toBe("10%");
  });

  it("is a no-op when total equals the mix sum", () => {
    const { container } = render(
      <RiskMixMicrobar mix={mix({ low: 50, medium: 50 })} total={100} />,
    );
    const segs = querySegs(container);
    expect(segs[0].style.width).toBe("50%");
    expect(segs[1].style.width).toBe("50%");
  });
});

describe("RiskMixMicrobar — accessibility", () => {
  it("exposes role=img with an aria-label summarizing the present tiers", () => {
    const { container } = render(<RiskMixMicrobar mix={mix({ low: 234, medium: 12, high: 5 })} />);
    const bar = queryBar(container);
    expect(bar?.getAttribute("role")).toBe("img");
    const label = bar?.getAttribute("aria-label") ?? "";
    expect(label).toMatch(/risk mix today/);
    expect(label).toContain("low 234");
    expect(label).toContain("med 12");
    expect(label).toContain("high 5");
    // Only present tiers — no crit in the label when crit is zero.
    expect(label).not.toContain("crit");
  });

  it("sets a native `title` tooltip matching the aria summary", () => {
    const { container } = render(<RiskMixMicrobar mix={mix({ low: 10, critical: 1 })} />);
    const title = queryBar(container)?.getAttribute("title") ?? "";
    // Format: "risk today — low N · crit N" (dot separator is U+00B7).
    expect(title).toMatch(/^risk today — /);
    expect(title).toContain("low 10");
    expect(title).toContain("crit 1");
  });
});
