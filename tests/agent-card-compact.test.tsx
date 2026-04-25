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
import type { AgentInfo } from "../dashboard/src/lib/types";

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
    const cases: { score: number; suffix: string }[] = [
      { score: 10, suffix: "low" },
      { score: 40, suffix: "med" },
      { score: 70, suffix: "high" },
      { score: 90, suffix: "crit" },
    ];
    for (const { score, suffix } of cases) {
      const { container, unmount } = renderCard(makeAgent({ avgRiskScore: score }));
      const badge = container.querySelector(".cl-tier");
      expect(badge, `score=${score}`).not.toBeNull();
      expect(badge?.className, `score=${score}`).toMatch(new RegExp(`\\bcl-tier-${suffix}\\b`));
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

  it("threads agentId into the popover so the click-through link targets the right agent", () => {
    // Regression guard: if AgentCardCompact forgets to pass agentId, the
    // popover renders without a Link target and the drill-through silently
    // breaks. Assert the href explicitly.
    const { container } = renderCard(makeAgent({ id: "seo-growth" }));
    const wrap = container.querySelector<HTMLElement>("[data-cl-risk-mix-wrapper]")!;
    fireEvent.mouseEnter(wrap);
    act(() => {
      vi.advanceTimersByTime(150);
    });
    const link = container.querySelector<HTMLAnchorElement>("[data-cl-risk-mix-pop-link]");
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href") ?? "").toContain("agent=seo-growth");
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
    const popLink = container.querySelector<HTMLAnchorElement>("[data-cl-risk-mix-pop-link]")!;
    fireEvent.click(popLink);

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

  it("during summary loading, the sparkles SVG carries cl-ai-pulse (text node sits next to it, unanimated)", () => {
    useSessionSummaryMock.mockReturnValue({
      summary: null,
      isLlmGenerated: false,
      loading: true,
      generate: vi.fn(),
    });
    const { container } = renderCard(withSession());
    // The label "Summarizing…" is rendered alongside a sparkles icon; the
    // pulse class lives on the SVG so only the icon animates.
    const span = Array.from(container.querySelectorAll("span")).find((s) =>
      (s.textContent ?? "").includes("Summarizing"),
    );
    expect(span, "summarizing span present").not.toBeUndefined();
    const svg = span!.querySelector("svg");
    expect(svg, "summarizing span has a sparkles icon").not.toBeNull();
    expect(svg!.getAttribute("class") ?? svg!.classList.value).toMatch(/\bcl-ai-pulse\b/);
    // Defensive: the cl-ai-pulse class belongs only on the SVG, never on the
    // outer span (the spec wants the icon pulsing, not the whole label).
    expect(span!.className ?? "").not.toMatch(/\bcl-ai-pulse\b/);
  });
});
