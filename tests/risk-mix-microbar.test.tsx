// @vitest-environment jsdom

import { act, fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

function queryLabel(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>("[data-cl-risk-mix-label]");
}

function renderBar(node: React.ReactElement) {
  // All tests wrap in MemoryRouter because the popover's click-through link
  // is a React Router <Link>, which requires a routing context.
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

describe("RiskMixMicrobar — rendering", () => {
  it("renders four segments in severity order when every tier is present", () => {
    const { container } = renderBar(
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
    const { container } = renderBar(<RiskMixMicrobar mix={mix({ low: 80, medium: 20 })} />);
    const segs = querySegs(container);
    expect(segs).toHaveLength(2);
    expect(segs[0].getAttribute("data-cl-risk-mix-seg")).toBe("low");
    expect(segs[1].getAttribute("data-cl-risk-mix-seg")).toBe("medium");
  });

  it("renders a single full-width segment for all-low agents", () => {
    // The common case — a healthy agent does 100% low-tier work. Ensures the
    // bar reads as solid green, not a truncated stub.
    const { container } = renderBar(<RiskMixMicrobar mix={mix({ low: 234 })} />);
    const segs = querySegs(container);
    expect(segs).toHaveLength(1);
    expect(segs[0].getAttribute("data-cl-risk-mix-seg")).toBe("low");
    expect(segs[0].style.width).toBe("100%");
  });

  it("computes segment widths as share of sum when no total prop given", () => {
    const { container } = renderBar(<RiskMixMicrobar mix={mix({ low: 90, medium: 5, high: 5 })} />);
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
    const { container } = renderBar(<RiskMixMicrobar mix={mix({})} />);
    expect(queryBar(container)).toBeNull();
  });

  it("still renders (empty track) when total is provided even if mix is zero", () => {
    // total=12 with an all-zero mix means `12 actions today, none scored` —
    // the bar's track should still paint so the card layout stays stable.
    // No segments draw, but the container exists.
    const { container } = renderBar(<RiskMixMicrobar mix={mix({})} total={12} />);
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
    const { container } = renderBar(<RiskMixMicrobar mix={mix({ low: 10 })} total={100} />);
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
    const { container } = renderBar(
      <RiskMixMicrobar mix={mix({ low: 234, medium: 12, high: 5 })} />,
    );
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

  it("does not set a native `title` tooltip — replaced by the rich popover", () => {
    // Regression guard: native browser tooltips have ~1s delay which is the
    // exact UX problem the popover fixes. Removing `title` ensures the popover
    // is the only hover surface so users don't see both.
    const { container } = renderBar(<RiskMixMicrobar mix={mix({ low: 10, critical: 1 })} />);
    expect(queryBar(container)?.hasAttribute("title")).toBe(false);
  });
});

describe("RiskMixMicrobar — bar thickness", () => {
  it("renders the track at 8px height with 4px radius", () => {
    // Thickened from 4→8 after live walkthrough: at 4px the bar was readable
    // as proportion but not legible as "risk visualization." 8px is the
    // smallest height at which the bar carries visual weight on the card.
    const { container } = renderBar(<RiskMixMicrobar mix={mix({ low: 10 })} />);
    const bar = queryBar(container);
    expect(bar).not.toBeNull();
    expect(bar?.style.height).toBe("8px");
    expect(bar?.style.borderRadius).toBe("4px");
  });
});

describe("RiskMixMicrobar — inline semantic label", () => {
  it('renders "All routine" in low-tier color for an all-low agent', () => {
    const { container } = renderBar(<RiskMixMicrobar mix={mix({ low: 234 })} />);
    const lbl = queryLabel(container);
    expect(lbl).not.toBeNull();
    expect(lbl?.textContent).toBe("All routine");
    expect(lbl?.style.color).toMatch(/--cl-risk-low/);
  });

  it('renders "X% elevated" in medium-tier color when medium > 0 and no high/crit', () => {
    // 20 medium out of 100 → 20% elevated. Color token: --cl-risk-medium.
    const { container } = renderBar(<RiskMixMicrobar mix={mix({ low: 80, medium: 20 })} />);
    const lbl = queryLabel(container);
    expect(lbl?.textContent).toBe("20% elevated");
    expect(lbl?.style.color).toMatch(/--cl-risk-medium/);
  });

  it('renders "X% high-risk" in high-tier color when high > 0 and no crit', () => {
    // (med + high + crit) / denominator = (0 + 3 + 0) / 10 → 30% high-risk.
    const { container } = renderBar(<RiskMixMicrobar mix={mix({ low: 7, high: 3 })} />);
    const lbl = queryLabel(container);
    expect(lbl?.textContent).toBe("30% high-risk");
    expect(lbl?.style.color).toMatch(/--cl-risk-high/);
  });

  it('renders "N critical · X% elevated" in critical color when any crit is present', () => {
    // Crit takes top billing because rare and alarming. Elevated % is the
    // cumulative non-low share so reviewers see "how much of today was risky."
    // 2 crit + 7 high + 11 med + 4 low = 24 scored. elevated% = 20/24 = 83%.
    const { container } = renderBar(
      <RiskMixMicrobar mix={mix({ low: 4, medium: 11, high: 7, critical: 2 })} />,
    );
    const lbl = queryLabel(container);
    expect(lbl?.textContent).toBe("2 critical · 83% elevated");
    expect(lbl?.style.color).toMatch(/--cl-risk-critical/);
  });

  it("uses `total` as the denominator when given (matches bar width math)", () => {
    // 10 medium out of 100 total (not just 10 scored) → 10% elevated.
    // Regression guard: the label must agree with the bar's arc-length math.
    const { container } = renderBar(<RiskMixMicrobar mix={mix({ medium: 10 })} total={100} />);
    expect(queryLabel(container)?.textContent).toBe("10% elevated");
  });

  it("floors sub-1% non-low shares to 1% instead of displaying 0%", () => {
    // 1 medium in 500 scored rounds to 0% mathematically; clamp to 1% so the
    // label doesn't say "0% elevated" when the tier is actually present.
    // Misleads worse than a small rounding lie.
    const { container } = renderBar(<RiskMixMicrobar mix={mix({ low: 499, medium: 1 })} />);
    expect(queryLabel(container)?.textContent).toBe("1% elevated");
  });

  it("renders no label when denominator is 0", () => {
    // Empty-state already returns null at component level — this asserts no
    // regression if someone later splits label rendering from bar rendering.
    const { container } = renderBar(<RiskMixMicrobar mix={mix({})} />);
    expect(queryLabel(container)).toBeNull();
  });

  it("uses tabular-nums + monospaced font (matches footer stat style)", () => {
    // Tabular digits prevent percentage values from jitter as the number
    // changes in live data.
    const { container } = renderBar(<RiskMixMicrobar mix={mix({ low: 50, medium: 50 })} />);
    const lbl = queryLabel(container);
    expect(lbl?.style.fontFamily).toMatch(/--cl-font-mono/);
    expect(lbl?.style.fontVariantNumeric || lbl?.className || "").toMatch(/tabular-nums|tabular/);
  });
});

describe("RiskMixMicrobar — hover popover orchestration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function queryPopover(container: HTMLElement): HTMLElement | null {
    return container.querySelector<HTMLElement>("[data-cl-risk-mix-popover]");
  }

  function queryWrapper(container: HTMLElement): HTMLElement | null {
    // The wrapper is the focusable/hoverable container that owns the popover.
    return container.querySelector<HTMLElement>("[data-cl-risk-mix-wrapper]");
  }

  it("mounts the popover ~120ms after mouseenter (deferred, not sluggish)", () => {
    // Defers briefly so accidental pointer crossings don't flash content,
    // but short enough to feel responsive — fixes the 1s native-title delay.
    const { container } = renderBar(
      <RiskMixMicrobar mix={mix({ low: 10, critical: 1 })} agentId="alpha" />,
    );
    expect(queryPopover(container)).toBeNull();
    const wrap = queryWrapper(container)!;
    fireEvent.mouseEnter(wrap);
    // Pre-delay: still closed.
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(queryPopover(container)).toBeNull();
    act(() => {
      vi.advanceTimersByTime(30);
    });
    expect(queryPopover(container)).not.toBeNull();
  });

  it("dismisses the popover ~300ms after mouseleave (hysteresis for cursor transit)", () => {
    // The 300ms hysteresis gives users time to slide from the bar into the
    // popover body without it vanishing mid-transit. Common gotcha.
    const { container } = renderBar(
      <RiskMixMicrobar mix={mix({ low: 10, critical: 1 })} agentId="alpha" />,
    );
    const wrap = queryWrapper(container)!;
    fireEvent.mouseEnter(wrap);
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(queryPopover(container)).not.toBeNull();
    fireEvent.mouseLeave(wrap);
    // Partway through the hysteresis — should still be visible.
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(queryPopover(container)).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(queryPopover(container)).toBeNull();
  });

  it("cancels the close timer when the cursor enters the popover itself", () => {
    // User slides from bar → popover → the close timer scheduled on the
    // bar-leave must be cancelled so the popover body stays rendered.
    const { container } = renderBar(
      <RiskMixMicrobar mix={mix({ low: 10, medium: 5 })} agentId="alpha" />,
    );
    const wrap = queryWrapper(container)!;
    fireEvent.mouseEnter(wrap);
    act(() => {
      vi.advanceTimersByTime(150);
    });
    fireEvent.mouseLeave(wrap);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    // Cursor enters popover before the 300ms elapses.
    const pop = queryPopover(container)!;
    fireEvent.mouseEnter(pop);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(queryPopover(container)).not.toBeNull();
  });

  it("closes on Escape when the popover is open", () => {
    const { container } = renderBar(
      <RiskMixMicrobar mix={mix({ low: 10, high: 2 })} agentId="alpha" />,
    );
    const wrap = queryWrapper(container)!;
    fireEvent.mouseEnter(wrap);
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(queryPopover(container)).not.toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(queryPopover(container)).toBeNull();
  });

  it("exposes tabIndex=0 on the wrapper and opens on focus", () => {
    // Keyboard parity with hover — the bar is interactive, so it must be
    // reachable via Tab and announce the popover on focus.
    const { container } = renderBar(
      <RiskMixMicrobar mix={mix({ low: 10, critical: 1 })} agentId="alpha" />,
    );
    const wrap = queryWrapper(container)!;
    expect(wrap.getAttribute("tabindex")).toBe("0");
    fireEvent.focus(wrap);
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(queryPopover(container)).not.toBeNull();
  });

  it("does not mount the popover when the mix is empty (denominator 0)", () => {
    // Defensive: empty agents should produce no popover even on hover, since
    // there is literally nothing to show.
    const { container } = renderBar(<RiskMixMicrobar mix={mix({})} total={0} agentId="alpha" />);
    // Whole component returns null, so there's no wrapper to hover.
    expect(queryWrapper(container)).toBeNull();
    expect(queryPopover(container)).toBeNull();
  });
});
