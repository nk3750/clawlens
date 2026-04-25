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

describe("RiskMixMicrobar — inline count label (tier-symmetric)", () => {
  // Spec: agent-card-risk-signals — the label is now "N <tier-short>" in the
  // worst-present tier's color. Vocabulary matches the pill (low/med/high/crit).
  // No `elevated`, no `high-risk`, no `routine`.

  it('renders "3 crit" in critical color when any crit is present (priority cascade top)', () => {
    const { container } = renderBar(<RiskMixMicrobar mix={mix({ low: 10, critical: 3 })} />);
    const lbl = queryLabel(container);
    expect(lbl?.textContent).toBe("3 crit");
    expect(lbl?.style.color).toMatch(/--cl-risk-critical/);
  });

  it('renders "1 crit" singular — no English "s" appended to short tier labels', () => {
    // Pluralisation lock: the TIER_SHORT vocabulary is mono-form. "1 crit"
    // not "1 crits", "1 crit" not "1 critical". Matches the pill text.
    const { container } = renderBar(<RiskMixMicrobar mix={mix({ low: 100, critical: 1 })} />);
    const lbl = queryLabel(container);
    expect(lbl?.textContent).toBe("1 crit");
    expect(lbl?.style.color).toMatch(/--cl-risk-critical/);
  });

  it('renders "2 high" in high color when high present and no crit', () => {
    // High wins the cascade when crit is absent. Count is the high count
    // alone, not (med + high). Spec lock against ambiguous numerator.
    const { container } = renderBar(<RiskMixMicrobar mix={mix({ low: 10, high: 2 })} />);
    const lbl = queryLabel(container);
    expect(lbl?.textContent).toBe("2 high");
    expect(lbl?.style.color).toMatch(/--cl-risk-high/);
  });

  it('renders "5 med" in medium color when medium present and no high/crit', () => {
    const { container } = renderBar(<RiskMixMicrobar mix={mix({ low: 95, medium: 5 })} />);
    const lbl = queryLabel(container);
    expect(lbl?.textContent).toBe("5 med");
    expect(lbl?.style.color).toMatch(/--cl-risk-medium/);
  });

  it('renders "100 low" in low color when only low is present (positive reassurance)', () => {
    // Symmetric with the other three tiers — every active card gets a count.
    // No empty label state for all-low; reviewer sees green bar + green count.
    const { container } = renderBar(<RiskMixMicrobar mix={mix({ low: 100 })} />);
    const lbl = queryLabel(container);
    expect(lbl?.textContent).toBe("100 low");
    expect(lbl?.style.color).toMatch(/--cl-risk-low/);
  });

  it('renders "1 low" singular — pluralisation lock for low tier too', () => {
    const { container } = renderBar(<RiskMixMicrobar mix={mix({ low: 1 })} />);
    expect(queryLabel(container)?.textContent).toBe("1 low");
  });

  it("counts only the worst-present tier (low: 100, high: 2 → '2 high', not '102 high')", () => {
    // Numerator-source lock: the count is the worst tier's own count, not the
    // cumulative non-low total. Spec §2 fix for the ambiguous-numerator bug.
    const { container } = renderBar(<RiskMixMicrobar mix={mix({ low: 100, high: 2 })} />);
    expect(queryLabel(container)?.textContent).toBe("2 high");
  });

  it("crit count is the crit count alone (low: 4, med: 11, high: 7, crit: 2 → '2 crit')", () => {
    // Stress test the cascade: med + high + crit all present, label still picks
    // crit and reports just the crit count.
    const { container } = renderBar(
      <RiskMixMicrobar mix={mix({ low: 4, medium: 11, high: 7, critical: 2 })} />,
    );
    expect(queryLabel(container)?.textContent).toBe("2 crit");
  });

  it("renders no label and no microbar when denominator is 0 (empty mix)", () => {
    // Empty state has no bar, so it has no label either. The whole microbar
    // element must be absent — regression guard against splitting label
    // rendering from bar rendering and producing an orphan label.
    const { container } = renderBar(<RiskMixMicrobar mix={mix({})} />);
    expect(queryBar(container)).toBeNull();
    expect(queryLabel(container)).toBeNull();
  });

  it("renders the microbar (no label) when total is provided but mix is all-zero", () => {
    // total=12 with an all-zero mix means "12 actions today, none scored" —
    // bar's empty track stays so the card layout is stable, but no tier is
    // present so the label has no content to surface.
    const { container } = renderBar(<RiskMixMicrobar mix={mix({})} total={12} />);
    expect(queryBar(container)).not.toBeNull();
    expect(queryLabel(container)).toBeNull();
  });

  it("uses tabular-nums + monospaced font (matches footer stat style)", () => {
    // Tabular digits prevent count values from jittering as live data updates.
    const { container } = renderBar(<RiskMixMicrobar mix={mix({ low: 50, medium: 50 })} />);
    const lbl = queryLabel(container);
    expect(lbl?.style.fontFamily).toMatch(/--cl-font-mono/);
    expect(lbl?.style.fontVariantNumeric || lbl?.className || "").toMatch(/tabular-nums|tabular/);
  });
});

describe("RiskMixMicrobar — taxonomy lock (no `elevated` / `high-risk` / `routine`)", () => {
  // Substring sweep across the label state machine. The spec is explicit that
  // the agent card's risk vocabulary is unified to low/med/high/crit (matching
  // the pill). Any future PR that re-introduces the legacy `elevated` /
  // `high-risk` / `routine` strings into the inline label fails this sweep.

  // Representative shapes — every branch of the new state machine plus the
  // boundary cases that historically produced different vocabularies.
  const SHAPES: Record<string, Partial<Record<RiskTier, number>>>[] = [
    [{ "all-low": { low: 100 } }],
    [{ "single-low": { low: 1 } }],
    [{ "med-only-5pct": { low: 95, medium: 5 } }],
    [{ "med-only-20pct": { low: 80, medium: 20 } }],
    [{ "med-sub-1pct": { low: 499, medium: 1 } }],
    [{ "high-1": { low: 100, high: 1 } }],
    [{ "high-2": { low: 10, high: 2 } }],
    [{ "high-many": { low: 50, high: 7 } }],
    [{ "crit-1": { low: 100, critical: 1 } }],
    [{ "crit-many": { low: 10, critical: 3 } }],
    [{ "all-tiers": { low: 4, medium: 11, high: 7, critical: 2 } }],
    [{ "issue-fixture": { low: 92, critical: 8 } }],
    [{ med: { medium: 10 } }],
    [{ "high-only": { high: 5 } }],
    [{ "crit-only": { critical: 1 } }],
  ];

  const FORBIDDEN = ["elevated", "high-risk", "routine"];

  it.each(
    SHAPES.flatMap((s) => Object.entries(s[0])),
  )("shape %s → label contains none of: elevated, high-risk, routine", (shapeLabel, partial) => {
    const { container } = renderBar(<RiskMixMicrobar mix={mix(partial)} />);
    const text = queryLabel(container)?.textContent ?? "";
    for (const banned of FORBIDDEN) {
      expect(text, `shape=${shapeLabel} banned=${banned}`).not.toContain(banned);
    }
  });

  it("aria-label on the bar also avoids the legacy vocabulary", () => {
    // The bar's role=img aria-label is the screen-reader equivalent of the
    // label. Locking it too keeps a11y output in sync with the visible label.
    const cases = SHAPES.flatMap((s) => Object.values(s[0]));
    for (const partial of cases) {
      const { container, unmount } = renderBar(<RiskMixMicrobar mix={mix(partial)} />);
      const aria = queryBar(container)?.getAttribute("aria-label") ?? "";
      for (const banned of FORBIDDEN) {
        expect(aria, `aria banned=${banned}`).not.toContain(banned);
      }
      unmount();
    }
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
