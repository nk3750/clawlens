// @vitest-environment jsdom

import { act, fireEvent, render } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted spy used to swap useSessionSummary's return value per-test (loading,
// loaded, idle). Defining it via vi.hoisted keeps it visible inside vi.mock.
const useSessionSummaryMock = vi.hoisted(() =>
  vi.fn(() => ({
    summary: null as string | null,
    isLlmGenerated: false,
    loading: false,
    generate: vi.fn(),
  })),
);
vi.mock("../dashboard/src/hooks/useSessionSummary", () => ({
  useSessionSummary: useSessionSummaryMock,
}));

import AgentCardCompact from "../dashboard/src/components/AgentCardCompact";
import type { AgentInfo, RiskTier } from "../dashboard/src/lib/types";

const NOW_ISO = "2026-04-20T12:00:00.000Z";

function makeAgent(partial: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: "alpha",
    name: "alpha-agent",
    status: "active",
    todayToolCalls: 12,
    avgRiskScore: 40, // medium tier per riskTierFromScore (>25, <=50)
    peakRiskScore: 55,
    lastActiveTimestamp: NOW_ISO,
    mode: "interactive",
    riskPosture: "calm",
    // New taxonomy: six pure-domain buckets (exploring/changes/git/scripts/web/comms).
    activityBreakdown: {
      exploring: 5,
      changes: 3,
      git: 1,
      scripts: 2,
      web: 1,
      comms: 0,
    },
    todayActivityBreakdown: {
      exploring: 5,
      changes: 3,
      git: 1,
      scripts: 2,
      web: 1,
      comms: 0,
    },
    needsAttention: false,
    blockedCount: 0,
    riskProfile: { low: 0, medium: 1, high: 0, critical: 0 },
    todayRiskMix: { low: 10, medium: 2, high: 0, critical: 0 },
    hourlyActivity: Array.from({ length: 24 }, () => 0),
    ...partial,
  };
}

function renderCard(agent: AgentInfo, needsAttention?: boolean) {
  return render(
    <MemoryRouter>
      <AgentCardCompact agent={agent} needsAttention={needsAttention} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW_ISO));
  useSessionSummaryMock.mockReturnValue({
    summary: null,
    isLlmGenerated: false,
    loading: false,
    generate: vi.fn(),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("AgentCardCompact — category bars + icons (agent-card-polish §2)", () => {
  it("tints the bar fill with the row's category color (75% mix on rgba(255,255,255,0.04) track)", () => {
    // Spec §2: every category row reads as a single tinted bar so the icon stroke
    // and the bar fill share one hue. Track is a flat translucent-white step;
    // only the inner fill carries the category var.
    const agent = makeAgent({
      todayActivityBreakdown: {
        exploring: 4,
        changes: 3,
        git: 2,
        scripts: 2,
        web: 2,
        comms: 1,
      },
    });
    const { container } = renderCard(agent);

    const rows = container.querySelectorAll<HTMLElement>("[data-cl-cat-row]");
    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      const cat = row.querySelector<SVGElement>("svg")?.getAttribute("stroke") ?? "";
      // Track = the .flex-1 div; fill = its only inline-styled child div.
      const track = row.querySelector<HTMLElement>("div.flex-1");
      expect(track, "track div present").not.toBeNull();
      expect(track!.style.backgroundColor ?? "").not.toMatch(/--cl-cat-/);

      const fill = track!.querySelector<HTMLElement>("div");
      expect(fill, "fill div present").not.toBeNull();
      const fillBg = fill!.style.backgroundColor ?? "";
      // Fill must reference the SAME category token as the icon stroke, at 75%
      // via color-mix. Locks "icon and bar share one hue" against drift.
      expect(fillBg).toMatch(/--cl-cat-/);
      expect(fillBg).toMatch(/75%/);
      // Icon stroke and fill must reference the same --cl-cat-{name} token.
      const iconToken = cat.match(/--cl-cat-[a-z]+/)?.[0] ?? "";
      expect(iconToken).not.toBe("");
      expect(fillBg).toContain(iconToken);
    }
  });

  it("colors category icons via CATEGORY_META (--cl-cat-* tokens on SVG stroke)", () => {
    // Icons are 12×12 strokes — low visual weight, high categorical signal. Restoring
    // hue here after the initial Stage C monochrome pass gives the card differentiation
    // without re-introducing the rainbow bars.
    const agent = makeAgent({
      todayActivityBreakdown: {
        exploring: 4,
        changes: 3,
        git: 2,
        scripts: 2,
        web: 0,
        comms: 0,
      },
    });
    const { container } = renderCard(agent);

    const svgs = container.querySelectorAll("[data-cl-cat-row] svg");
    expect(svgs.length).toBeGreaterThan(0);
    const strokes = Array.from(svgs).map((s) => s.getAttribute("stroke") ?? "");
    // Every surfaced icon must reference a --cl-cat-* token.
    for (const stroke of strokes) {
      expect(stroke).toMatch(/--cl-cat-/);
    }
    // And the set of strokes must include more than one distinct token (i.e. the icons
    // carry per-category hue, not a single shared one).
    expect(new Set(strokes).size).toBeGreaterThan(1);
  });

  it("renders exactly one row per surfaced category (top 4), anchored with data-cl-cat-row", () => {
    const agent = makeAgent({
      todayActivityBreakdown: {
        exploring: 4,
        changes: 3,
        git: 2,
        scripts: 1,
        web: 0,
        comms: 0,
      },
    });
    const { container } = renderCard(agent);
    const rows = container.querySelectorAll("[data-cl-cat-row]");
    expect(rows.length).toBe(4);
  });

  it("caps category rows at 4 even when all 6 categories are surfaced", () => {
    const agent = makeAgent({
      todayActivityBreakdown: {
        exploring: 5,
        changes: 4,
        git: 3,
        scripts: 2,
        web: 1,
        comms: 1,
      },
    });
    const { container } = renderCard(agent);
    const rows = container.querySelectorAll("[data-cl-cat-row]");
    expect(rows.length).toBe(4);
  });

  it("renders a '+N more' overflow row when more than 4 categories are surfaced", () => {
    const agent = makeAgent({
      todayActivityBreakdown: {
        exploring: 5,
        changes: 4,
        git: 3,
        scripts: 2,
        web: 1,
        comms: 1,
      },
    });
    const { container } = renderCard(agent);
    // Six surfaced, top 4 shown → 2 overflow.
    expect(container.textContent).toMatch(/\+2 more/);
  });
});

describe("AgentCardCompact — Linear-adjacent chrome (Stage C skin)", () => {
  it("uses the .cl-card utility class on the outer Link anchor", () => {
    const { container } = renderCard(makeAgent());
    const anchor = container.querySelector("a");
    expect(anchor).not.toBeNull();
    expect(anchor?.className).toMatch(/\bcl-card\b/);
  });

  it("preserves the whole-card Link behavior (href points at /agent/:id)", () => {
    const { container } = renderCard(makeAgent({ id: "social-manager" }));
    const anchor = container.querySelector("a");
    expect(anchor?.getAttribute("href")).toBe("/agent/social-manager");
  });

  it("applies an inset 2px --cl-risk-medium box-shadow when needsAttention is true", () => {
    const { container } = renderCard(makeAgent(), true);
    const anchor = container.querySelector<HTMLAnchorElement>("a");
    expect(anchor).not.toBeNull();
    const shadow = anchor?.style.boxShadow ?? "";
    expect(shadow).toMatch(/inset/);
    expect(shadow).toMatch(/2px/);
    expect(shadow).toMatch(/--cl-risk-medium/);
  });

  it("sets data-cl-agent-attention when flagged", () => {
    const { container } = renderCard(makeAgent(), true);
    const flagged = container.querySelector("[data-cl-agent-attention]");
    expect(flagged).not.toBeNull();
    expect(flagged?.getAttribute("data-cl-agent-attention")).toBe("true");
  });

  it("does NOT set data-cl-agent-attention when unflagged", () => {
    const { container } = renderCard(makeAgent({ needsAttention: false }), false);
    expect(container.querySelector("[data-cl-agent-attention]")).toBeNull();
  });

  it("renders the tier badge via .cl-tier / .cl-tier-<short> utility classes", () => {
    // score 40 → tier "medium" → .cl-tier-med
    const { container } = renderCard(makeAgent({ avgRiskScore: 40 }));
    const badge = container.querySelector(".cl-tier");
    expect(badge).not.toBeNull();
    expect(badge?.className).toMatch(/\bcl-tier-med\b/);
  });

  it("maps tier → short suffix: low/med/high/crit", () => {
    // Tier badge derivation now flows through worstMeaningfulTier(todayRiskMix),
    // not riskTierFromScore(avgRiskScore). Each fixture forces the corresponding
    // branch of the compound rule.
    const cases: { mix: Record<RiskTier, number>; suffix: string; label: string }[] = [
      { mix: { low: 100, medium: 0, high: 0, critical: 0 }, suffix: "low", label: "all-low" },
      { mix: { low: 95, medium: 5, high: 0, critical: 0 }, suffix: "med", label: "med share=5%" },
      { mix: { low: 100, medium: 0, high: 2, critical: 0 }, suffix: "high", label: "high=2" },
      { mix: { low: 100, medium: 0, high: 0, critical: 1 }, suffix: "crit", label: "crit=1" },
    ];
    for (const { mix, suffix, label } of cases) {
      const { container, unmount } = renderCard(makeAgent({ todayRiskMix: mix }));
      const badge = container.querySelector(".cl-tier");
      expect(badge, label).not.toBeNull();
      expect(badge?.className, label).toMatch(new RegExp(`\\bcl-tier-${suffix}\\b`));
      unmount();
    }
  });

  it("fades idle agents to 35% opacity", () => {
    const idle = makeAgent({ todayToolCalls: 0, status: "idle" });
    const { container } = renderCard(idle);
    const anchor = container.querySelector<HTMLAnchorElement>("a");
    expect(anchor?.style.opacity).toBe("0.35");
  });

  it("keeps GradientAvatar in the card identity row", () => {
    // GradientAvatar applies a linear-gradient via inline style. Sanity-check it
    // still renders so the one approved gradient use is preserved.
    const { container } = renderCard(makeAgent());
    const withGradient = Array.from(container.querySelectorAll<HTMLElement>("div")).find((el) =>
      el.style.background?.includes("linear-gradient"),
    );
    expect(withGradient).toBeDefined();
  });
});

describe("AgentCardCompact — pill derivation from todayRiskMix (compound rule)", () => {
  // Spec: agent-card-risk-signals — pill derivation moved off riskTierFromScore(avg)
  // to worstMeaningfulTier(mix) so the headline surfaces outliers instead of
  // hiding them in an average. Each test pins one branch of the compound rule.

  function tierBadgeClass(container: HTMLElement): string {
    return container.querySelector(".cl-tier")?.className ?? "";
  }

  it("pill reads CRIT when a single critical action is present (low: 100, critical: 1)", () => {
    const { container } = renderCard(
      makeAgent({ todayRiskMix: { low: 100, medium: 0, high: 0, critical: 1 } }),
    );
    expect(tierBadgeClass(container)).toMatch(/\bcl-tier-crit\b/);
  });

  it("pill reads LOW for a single high action (low: 100, high: 1) — single-call noise filter", () => {
    // Spec §4 design lock: 1 high doesn't promote on its own; the count label
    // surfaces it as "1 high" while the pill reports the day kind as LOW.
    const { container } = renderCard(
      makeAgent({ todayRiskMix: { low: 100, medium: 0, high: 1, critical: 0 } }),
    );
    expect(tierBadgeClass(container)).toMatch(/\bcl-tier-low\b/);
  });

  it("pill reads HIGH at the 2-high threshold (low: 100, high: 2)", () => {
    const { container } = renderCard(
      makeAgent({ todayRiskMix: { low: 100, medium: 0, high: 2, critical: 0 } }),
    );
    expect(tierBadgeClass(container)).toMatch(/\bcl-tier-high\b/);
  });

  it("pill reads MED at the 5% medium share boundary (low: 95, medium: 5)", () => {
    const { container } = renderCard(
      makeAgent({ todayRiskMix: { low: 95, medium: 5, high: 0, critical: 0 } }),
    );
    expect(tierBadgeClass(container)).toMatch(/\bcl-tier-med\b/);
  });

  it("pill reads LOW just under the 5% medium share threshold (low: 100, medium: 4)", () => {
    // 4 / 104 ≈ 3.85% — under 5%, so LOW.
    const { container } = renderCard(
      makeAgent({ todayRiskMix: { low: 100, medium: 4, high: 0, critical: 0 } }),
    );
    expect(tierBadgeClass(container)).toMatch(/\bcl-tier-low\b/);
  });

  it("pill reads CRIT for the failure-mode fixture (low: 92, critical: 8) — closes #17", () => {
    // Regression lock for the issue reported in #17. The old derivation
    // (riskTierFromScore(avgRiskScore)) read this as LOW because averaging
    // diluted 8 crits into a sub-25 mean. The compound rule must surface them.
    const { container } = renderCard(
      makeAgent({ todayRiskMix: { low: 92, medium: 0, high: 0, critical: 8 } }),
    );
    expect(tierBadgeClass(container)).toMatch(/\bcl-tier-crit\b/);
  });

  it("pill reads LOW for the empty-mix fallback (no scored actions)", () => {
    // Fixture overrides hasActivity-gating with a non-zero todayToolCalls, so
    // the badge renders even though every tier count is zero. Default branch.
    const { container } = renderCard(
      makeAgent({
        todayToolCalls: 12, // some unscored entries
        todayRiskMix: { low: 0, medium: 0, high: 0, critical: 0 },
      }),
    );
    expect(tierBadgeClass(container)).toMatch(/\bcl-tier-low\b/);
  });
});

describe("AgentCardCompact — risk-mix microbar (domain × risk axis split)", () => {
  it("renders the microbar when the agent has activity today", () => {
    const { container } = renderCard(makeAgent());
    const bar = container.querySelector("[data-cl-risk-mix-microbar]");
    expect(bar).not.toBeNull();
  });

  it("hides the microbar for idle agents (todayToolCalls === 0)", () => {
    // Matches the activity-strip hide rule — no ink, no wasted row.
    const idle = makeAgent({
      todayToolCalls: 0,
      status: "idle",
      todayRiskMix: { low: 0, medium: 0, high: 0, critical: 0 },
    });
    const { container } = renderCard(idle);
    expect(container.querySelector("[data-cl-risk-mix-microbar]")).toBeNull();
  });

  it("passes todayToolCalls as the microbar denominator (keeps width honest vs unscored entries)", () => {
    // 10 scored low + 2 scored medium = 12 scored. todayToolCalls = 20 → the
    // low segment should be 50% wide (10/20), not 83% (10/12). This is the
    // regression guard for "scoring gaps don't lie about distribution."
    const agent = makeAgent({
      todayToolCalls: 20,
      todayRiskMix: { low: 10, medium: 2, high: 0, critical: 0 },
    });
    const { container } = renderCard(agent);
    const segs = container.querySelectorAll<HTMLElement>("[data-cl-risk-mix-seg]");
    expect(segs).toHaveLength(2);
    expect(segs[0].style.width).toBe("50%");
    expect(segs[1].style.width).toBe("10%");
  });

  it("renders a single full-width low segment for all-low agents", () => {
    const agent = makeAgent({
      todayToolCalls: 234,
      todayRiskMix: { low: 234, medium: 0, high: 0, critical: 0 },
    });
    const { container } = renderCard(agent);
    const segs = container.querySelectorAll<HTMLElement>("[data-cl-risk-mix-seg]");
    expect(segs).toHaveLength(1);
    expect(segs[0].getAttribute("data-cl-risk-mix-seg")).toBe("low");
    expect(segs[0].style.width).toBe("100%");
  });

  it("places the microbar between the identity row and the activity strip", () => {
    // Structural guard: the microbar sits full-width above the breakdown bars
    // and below the avatar/name/tier row. Regression guard if someone moves
    // the row into the header and breaks the two-axis layout.
    const { container } = renderCard(makeAgent());
    const bar = container.querySelector<HTMLElement>("[data-cl-risk-mix-microbar]");
    const firstCatRow = container.querySelector<HTMLElement>("[data-cl-cat-row]");
    expect(bar).not.toBeNull();
    expect(firstCatRow).not.toBeNull();
    // Microbar must come first in document order.
    const pos = bar!.compareDocumentPosition(firstCatRow!);
    // Node.DOCUMENT_POSITION_FOLLOWING = 4
    expect(pos & 4).toBe(4);
  });
});

describe("AgentCardCompact — microbar popover wiring", () => {
  // These tests fake setTimeout so the 120ms show / 300ms hide delays can be
  // advanced deterministically without any real wall-clock waiting.
  //
  // Reset-then-fake pattern: the file-level beforeEach installs Date-only
  // fake timers; nesting a bare `vi.useFakeTimers()` doesn't cleanly swap
  // the config — advanceTimersByTime silently no-ops. Explicit reset fixes it.
  beforeEach(() => {
    vi.useRealTimers();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens the popover on microbar hover and closes on Esc", () => {
    const { container } = renderCard(makeAgent({ id: "seo-growth" }));
    const wrap = container.querySelector<HTMLElement>("[data-cl-risk-mix-wrapper]");
    expect(wrap).not.toBeNull();
    fireEvent.mouseEnter(wrap!);
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(container.querySelector("[data-cl-risk-mix-popover]")).not.toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(container.querySelector("[data-cl-risk-mix-popover]")).toBeNull();
  });

  it("threads agentId into the popover so the click-through navigates to the right agent", () => {
    // Regression guard: if AgentCardCompact forgets to pass agentId, the
    // popover renders without a navigate target and the drill-through silently
    // breaks. The popover button has no href to inspect (it uses useNavigate),
    // so we verify the actual navigation result via a LocationProbe.
    const observed: { search: string } = { search: "" };
    function LocationProbe() {
      observed.search = useLocation().search;
      return null;
    }
    const { container } = render(
      <MemoryRouter>
        <AgentCardCompact agent={makeAgent({ id: "seo-growth" })} />
        <LocationProbe />
      </MemoryRouter>,
    );
    const wrap = container.querySelector<HTMLElement>("[data-cl-risk-mix-wrapper]")!;
    fireEvent.mouseEnter(wrap);
    act(() => {
      vi.advanceTimersByTime(150);
    });
    const button = container.querySelector<HTMLButtonElement>("button[data-cl-risk-mix-pop-link]");
    expect(button).not.toBeNull();
    fireEvent.click(button!);
    expect(observed.search).toContain("agent=seo-growth");
  });

  it("clicking the popover link navigates to /activity, not to the card's /agent/:id", () => {
    // User-observable test: whichever Link handles the click determines the
    // destination. Without stopPropagation on the inner popover link, React
    // Router's outer card Link also fires and the outer navigation wins — the
    // user ends up on /agent/:id instead of /activity?tier=... (silent drill-
    // through failure). This verifies the guard via the actual route.
    const observed: { pathname: string; search: string } = { pathname: "", search: "" };
    function LocationProbe() {
      const loc = useLocation();
      observed.pathname = loc.pathname;
      observed.search = loc.search;
      return null;
    }
    const agent = makeAgent({ id: "seo-growth" });
    const { container } = render(
      <MemoryRouter>
        <AgentCardCompact agent={agent} />
        <LocationProbe />
      </MemoryRouter>,
    );

    const wrap = container.querySelector<HTMLElement>("[data-cl-risk-mix-wrapper]")!;
    fireEvent.mouseEnter(wrap);
    act(() => {
      vi.advanceTimersByTime(150);
    });
    const popButton = container.querySelector<HTMLButtonElement>(
      "button[data-cl-risk-mix-pop-link]",
    )!;
    fireEvent.click(popButton);

    expect(observed.pathname).toBe("/activity");
    expect(observed.search).toContain("agent=seo-growth");
    // Guard against the silent-failure case where the outer Link "wins":
    expect(observed.pathname).not.toBe("/agent/seo-growth");
  });
});

describe("AgentCardCompact — summarize button is an AI affordance (agent-card-polish §4)", () => {
  // The summarize button is the user's "this is an AI feature" surface on the
  // card. The icon + shimmer class are the genre conventions (Copilot, Linear,
  // Notion, Raycast) — they materially change how a reviewer reads the button.
  // Regressions here turn it back into a quiet text label that undersells the
  // generative action behind it.

  function withSession(): AgentInfo {
    // sessionKey is what gates the summary block + summarize button render.
    return makeAgent({ lastSessionKey: "alpha:s1" });
  }

  it("renders both a sparkles SVG and the literal text 'summarize' inside the button", () => {
    const { container } = renderCard(withSession());
    const btn = Array.from(container.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("summarize"),
    );
    expect(btn, "summarize button present").not.toBeUndefined();
    // Icon — present at rest, signals "this is an AI feature".
    const svg = btn!.querySelector("svg");
    expect(svg, "summarize button has an icon").not.toBeNull();
    // Stroke must reference the accent token — keeps the icon legible against
    // the gradient-clipped text on hover.
    expect(svg!.getAttribute("stroke") ?? "").toContain("--cl-accent");
    // Text — the existing label stays for screen-reader and keyboard users.
    expect(btn!.textContent ?? "").toMatch(/summarize/);
  });

  it("applies the cl-ai-shine class on the summarize button (not the SVG)", () => {
    // The shimmer animates the text via background-clip; the SVG sibling stays
    // solid. Locks the class onto the button element specifically.
    const { container } = renderCard(withSession());
    const btn = Array.from(container.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("summarize"),
    )!;
    expect(btn.className).toMatch(/\bcl-ai-shine\b/);
  });

  it("does NOT use the `background` shorthand inline (would clobber cl-ai-shine's gradient)", () => {
    // Regression guard for the "summarize text invisible" bug: the .cl-ai-shine
    // class sets `background-image: linear-gradient(...)` and `color: transparent`.
    // If the inline style sets `background: none` (or the shorthand at all),
    // it resets background-image, the gradient never paints, and the
    // background-clip: text leaves the text fully transparent — only the
    // sparkles SVG remains visible. Use `background-color` longhand instead.
    const { container } = renderCard(withSession());
    const btn = Array.from(container.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("summarize"),
    )!;
    expect(btn.style.background ?? "").not.toBe("none");
    expect(btn.style.backgroundImage ?? "").not.toBe("none");
  });

  it("does NOT set inline color via mouse handlers (would conflict with background-clip: text)", () => {
    // Spec §4 note: with `color: transparent` on the .cl-ai-shine class, the
    // legacy onMouseEnter/onMouseLeave color setters would erase the gradient
    // text. Removed in commit 2 — this guard fails if they come back.
    const { container } = renderCard(withSession());
    const btn = Array.from(container.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("summarize"),
    )!;
    fireEvent.mouseEnter(btn);
    expect(btn.style.color).not.toMatch(/--cl-accent/);
    fireEvent.mouseLeave(btn);
    expect(btn.style.color).not.toMatch(/--cl-accent/);
  });

  it("while loading, the button's sparkles icon carries cl-ai-pulse (popover skeleton shows the actual loading copy)", () => {
    // Loading state moved into <SummaryPopover>'s skeleton; the button's
    // SparklesIcon still pulses while the fetch is in flight to keep the
    // AI-aware feedback on the trigger element.
    useSessionSummaryMock.mockReturnValue({
      summary: null,
      isLlmGenerated: false,
      loading: true,
      generate: vi.fn(),
    });
    const { container } = renderCard(withSession());
    const btn = Array.from(container.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("summarize"),
    )!;
    const svg = btn.querySelector("svg");
    expect(svg, "summarize button has a sparkles icon").not.toBeNull();
    expect(svg!.getAttribute("class") ?? "").toMatch(/\bcl-ai-pulse\b/);
    // Defensive: the legacy inline "Summarizing…" span is gone — the popover
    // owns the loading copy now. If a regression re-adds it, this fails.
    const summarizingSpan = Array.from(container.querySelectorAll("span")).find((s) =>
      (s.textContent ?? "").includes("Summarizing"),
    );
    expect(summarizingSpan).toBeUndefined();
  });

  it("button's sparkles icon does NOT carry cl-ai-pulse at rest (no ambient pulse without a fetch)", () => {
    const { container } = renderCard(withSession());
    const btn = Array.from(container.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("summarize"),
    )!;
    const svg = btn.querySelector("svg");
    expect(svg!.getAttribute("class") ?? "").not.toMatch(/\bcl-ai-pulse\b/);
  });
});

describe("AgentCardCompact — summary popover wiring (#14 follow-up: card→popover)", () => {
  // The summary moved out of the inline 2-line clamp on the card body and
  // into a click-anchored popover. These tests pin the wiring contract:
  // click→mount, persistence post-load, dismiss machinery, no-inline-<p>,
  // and hover-bg gated on popoverOpen so the card stays visually anchored
  // while its popover is open.

  function withSession(): AgentInfo {
    return makeAgent({ lastSessionKey: "alpha:s1" });
  }

  function findSummarizeButton(container: HTMLElement): HTMLButtonElement {
    return Array.from(container.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("summarize"),
    ) as HTMLButtonElement;
  }

  it("does NOT render an inline <p> with the loaded summary text (legacy clamped layout is gone)", () => {
    useSessionSummaryMock.mockReturnValue({
      summary: "A loaded summary that used to be inline.",
      isLlmGenerated: true,
      loading: false,
      generate: vi.fn(),
    });
    const { container } = renderCard(withSession());
    // Card body should not contain the summary text in any <p>.
    const ps = container.querySelectorAll("p");
    for (const p of ps) {
      expect(p.textContent ?? "").not.toContain("A loaded summary");
    }
  });

  it("does NOT mount the popover at rest (no [data-cl-summary-popover] before click)", () => {
    const { container } = renderCard(withSession());
    expect(container.querySelector("[data-cl-summary-popover]")).toBeNull();
  });

  it("click on summarize mounts the popover and triggers fetchSummary", () => {
    const generate = vi.fn();
    useSessionSummaryMock.mockReturnValue({
      summary: null,
      isLlmGenerated: false,
      loading: false,
      generate,
    });
    const { container } = renderCard(withSession());
    fireEvent.click(findSummarizeButton(container));
    expect(generate).toHaveBeenCalledTimes(1);
    // Popover mounts immediately even before the fetch resolves (loading=true
    // state will paint the skeleton inside the already-mounted chrome).
    expect(container.querySelector("[data-cl-summary-popover]")).not.toBeNull();
  });

  it("clicking with a cached summary opens the popover without refetching", () => {
    const generate = vi.fn();
    useSessionSummaryMock.mockReturnValue({
      summary: "Cached summary already in state.",
      isLlmGenerated: true,
      loading: false,
      generate,
    });
    const { container } = renderCard(withSession());
    fireEvent.click(findSummarizeButton(container));
    expect(generate).not.toHaveBeenCalled();
    expect(container.querySelector("[data-cl-summary-popover]")).not.toBeNull();
  });

  it("button stays visible after summary loads (so the user can re-open the popover)", () => {
    useSessionSummaryMock.mockReturnValue({
      summary: "Loaded — re-clickable trigger.",
      isLlmGenerated: true,
      loading: false,
      generate: vi.fn(),
    });
    const { container } = renderCard(withSession());
    expect(findSummarizeButton(container)).not.toBeUndefined();
  });

  it("Escape closes the popover after it has been opened", () => {
    useSessionSummaryMock.mockReturnValue({
      summary: "Escape probe.",
      isLlmGenerated: true,
      loading: false,
      generate: vi.fn(),
    });
    const { container } = renderCard(withSession());
    fireEvent.click(findSummarizeButton(container));
    expect(container.querySelector("[data-cl-summary-popover]")).not.toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(container.querySelector("[data-cl-summary-popover]")).toBeNull();
  });

  it("outside-click (mousedown on document body) closes the popover", () => {
    useSessionSummaryMock.mockReturnValue({
      summary: "Outside click probe.",
      isLlmGenerated: true,
      loading: false,
      generate: vi.fn(),
    });
    const { container } = renderCard(withSession());
    fireEvent.click(findSummarizeButton(container));
    expect(container.querySelector("[data-cl-summary-popover]")).not.toBeNull();
    fireEvent.mouseDown(document.body);
    expect(container.querySelector("[data-cl-summary-popover]")).toBeNull();
  });

  it("clicking inside the popover does NOT close it", () => {
    useSessionSummaryMock.mockReturnValue({
      summary: "Inside click probe.",
      isLlmGenerated: true,
      loading: false,
      generate: vi.fn(),
    });
    const { container } = renderCard(withSession());
    fireEvent.click(findSummarizeButton(container));
    const pop = container.querySelector<HTMLElement>("[data-cl-summary-popover]")!;
    fireEvent.mouseDown(pop);
    expect(container.querySelector("[data-cl-summary-popover]")).not.toBeNull();
  });

  it("clicking summarize does NOT navigate (preventDefault + stopPropagation preserved)", () => {
    const observed: { pathname: string } = { pathname: "" };
    function LocationProbe() {
      const loc = useLocation();
      observed.pathname = loc.pathname;
      return null;
    }
    useSessionSummaryMock.mockReturnValue({
      summary: null,
      isLlmGenerated: false,
      loading: false,
      generate: vi.fn(),
    });
    const agent = withSession();
    const { container } = render(
      <MemoryRouter>
        <AgentCardCompact agent={agent} />
        <LocationProbe />
      </MemoryRouter>,
    );
    const initialPath = observed.pathname;
    fireEvent.click(findSummarizeButton(container));
    expect(observed.pathname).toBe(initialPath);
  });

  it("freezes the card hover background while popover is open (mouseleave does not revert)", () => {
    useSessionSummaryMock.mockReturnValue({
      summary: "Hover-freeze probe.",
      isLlmGenerated: true,
      loading: false,
      generate: vi.fn(),
    });
    const { container } = renderCard(withSession());
    const card = container.querySelector<HTMLAnchorElement>("a")!;
    // Hover lights the card bg.
    fireEvent.mouseEnter(card);
    expect(card.style.backgroundColor).toMatch(/--cl-bg-05/);
    // Open popover.
    fireEvent.click(findSummarizeButton(container));
    expect(container.querySelector("[data-cl-summary-popover]")).not.toBeNull();
    // Mouseleave should NOT clear the bg while the popover is anchored — the
    // active card needs to stay visually highlighted.
    fireEvent.mouseLeave(card);
    expect(card.style.backgroundColor).toMatch(/--cl-bg-05/);
  });
});
