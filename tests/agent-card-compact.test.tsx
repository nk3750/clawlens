// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("AgentCardCompact — de-rainbow activity bars (Stage C regression guard)", () => {
  it("keeps bar fills + tracks monochrome (no --cl-cat-* color tokens on bar backgrounds)", () => {
    // Active agent with several category buckets — all six surfaced at least once so the
    // legacy code path would have rendered the full rainbow.
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

    // Bars = the two inline-styled <div>s nested inside each category row. The Phase-1
    // review called these out as the "AI-slop rainbow" — they must stay monochrome.
    // Icons (SVG stroke) are allowed to carry category hue for subtle differentiation.
    const rows = container.querySelectorAll("[data-cl-cat-row]");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      for (const div of row.querySelectorAll("div")) {
        expect((div as HTMLElement).style.backgroundColor ?? "").not.toMatch(/--cl-cat-/);
      }
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
