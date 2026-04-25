// @vitest-environment jsdom

import { fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: vi.fn() };
});

import { useNavigate } from "react-router-dom";
import SummaryPopover from "../dashboard/src/components/SummaryPopover";

const mockedUseNavigate = vi.mocked(useNavigate);
const navigateSpy = vi.fn();

beforeEach(() => {
  navigateSpy.mockReset();
  mockedUseNavigate.mockReturnValue(navigateSpy);
});

function renderPopover(props: {
  summary: string | null;
  loading: boolean;
  agentId?: string;
  onClose?: () => void;
}) {
  return render(
    <MemoryRouter>
      <SummaryPopover
        summary={props.summary}
        loading={props.loading}
        agentId={props.agentId ?? "alpha"}
        onClose={props.onClose ?? (() => {})}
      />
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("SummaryPopover — render gating", () => {
  it("renders the popover chrome with a skeleton when summary is null (parent owns mount; popover renders unconditionally)", () => {
    // The card gates mount on `popoverOpen`, so by the time SummaryPopover
    // renders the parent has decided to show it. The popover always paints
    // chrome and falls back to a skeleton when summary isn't ready. Treats
    // (summary=null, loading=false) — the brief frame between click and the
    // hook flipping loading=true — as still-loading so the chrome doesn't
    // flash empty.
    const { container } = renderPopover({ summary: null, loading: false });
    expect(container.querySelector("[data-cl-summary-popover]")).not.toBeNull();
    expect(container.querySelector("[data-cl-summary-loading]")).not.toBeNull();
    expect(container.querySelector("[data-cl-summary-body]")).toBeNull();
  });

  it("renders the popover chrome with a loading indicator while fetching", () => {
    const { container } = renderPopover({ summary: null, loading: true });
    const pop = container.querySelector("[data-cl-summary-popover]");
    expect(pop).not.toBeNull();
    // Loading marker — distinct from the loaded body so tests can branch on it.
    expect(container.querySelector("[data-cl-summary-loading]")).not.toBeNull();
    // No body when loading.
    expect(container.querySelector("[data-cl-summary-body]")).toBeNull();
  });

  it("renders the summary body once loaded (no loading marker, no chrome regressions)", () => {
    const { container } = renderPopover({
      summary: "Triaging customer disputes and quietly resolving routine refunds.",
      loading: false,
    });
    expect(container.querySelector("[data-cl-summary-popover]")).not.toBeNull();
    expect(container.querySelector("[data-cl-summary-body]")).not.toBeNull();
    expect(container.querySelector("[data-cl-summary-loading]")).toBeNull();
  });
});

describe("SummaryPopover — per-word reveal (motion contract)", () => {
  it("splits the summary on whitespace and renders each word as its own .cl-summary-word span", () => {
    const summary = "Three short words.";
    const { container } = renderPopover({ summary, loading: false });
    const words = container.querySelectorAll("[data-cl-summary-body] .cl-summary-word");
    expect(words.length).toBe(3);
    expect(Array.from(words).map((w) => w.textContent)).toEqual(["Three", "short", "words."]);
  });

  it("staggers each word's animation-delay at 30ms while under the 800ms total-reveal clamp", () => {
    // 5 words → per-word budget = min(30, 800/5) = min(30, 160) = 30. Stagger
    // stays at 30ms because the clamp doesn't bind for short summaries.
    const summary = "Alpha bravo charlie delta echo.";
    const { container } = renderPopover({ summary, loading: false });
    const words = container.querySelectorAll<HTMLElement>(
      "[data-cl-summary-body] .cl-summary-word",
    );
    expect(words.length).toBe(5);
    expect(words[0].style.animationDelay).toBe("0ms");
    expect(words[1].style.animationDelay).toBe("30ms");
    expect(words[2].style.animationDelay).toBe("60ms");
    expect(words[3].style.animationDelay).toBe("90ms");
    expect(words[4].style.animationDelay).toBe("120ms");
  });

  it("clamps total reveal at ≤800ms regardless of summary length (long summaries shrink per-word delay)", () => {
    // 50-word summary → naive 30ms × 50 = 1500ms total. Clamp uses
    // min(30, 800/50) = 16ms per word → last word's delay = 16 × 49 = 784ms
    // ≤ 800ms. Locks the regression where long LLM outputs would reveal at a
    // sluggish ~1500ms wall-clock.
    const summary = Array.from({ length: 50 }, (_, i) => `word${i}`).join(" ");
    const { container } = renderPopover({ summary, loading: false });
    const words = container.querySelectorAll<HTMLElement>(
      "[data-cl-summary-body] .cl-summary-word",
    );
    expect(words.length).toBe(50);
    const lastDelayMs = parseFloat(words[49].style.animationDelay);
    expect(lastDelayMs).toBeLessThanOrEqual(800);
  });
});

describe("SummaryPopover — chrome", () => {
  it("uses the .cl-card chrome with cl-depth-pop shadow and the cl-pop-in-up keyframe", () => {
    const { container } = renderPopover({
      summary: "Anything to make it render.",
      loading: false,
    });
    const pop = container.querySelector<HTMLElement>("[data-cl-summary-popover]");
    expect(pop).not.toBeNull();
    expect(pop!.className).toMatch(/\bcl-card\b/);
    expect(pop!.style.boxShadow ?? "").toMatch(/--cl-depth-pop/);
    // Linear-style spring entrance, anchored above the trigger so the keyframe
    // rises up into rest (cl-pop-in-up, not cl-pop-in which drops down).
    expect(pop!.style.animation ?? "").toMatch(/cl-pop-in-up/);
  });

  it("anchors above + flush-right of the trigger (bottom: calc(100% + 6px); right: 0)", () => {
    // The summarize button lives in the card's bottom row. Anchoring `bottom`
    // pushes the popover upward into the card body so it never extends past
    // the card's outer edge. Flush-right keeps the popover visible without
    // overflowing the card's right edge.
    const { container } = renderPopover({
      summary: "Anchor probe.",
      loading: false,
    });
    const pop = container.querySelector<HTMLElement>("[data-cl-summary-popover]")!;
    expect(pop.style.position).toBe("absolute");
    expect(pop.style.bottom).toMatch(/calc\(100% \+ 6px\)/);
    expect(pop.style.right).toBe("0px");
    // Defensive: never anchor `top` — that would re-introduce the off-card overflow.
    expect(pop.style.top).toBe("");
  });

  it("renders a SUMMARY · TODAY mono uppercase header", () => {
    const { container } = renderPopover({
      summary: "Header probe.",
      loading: false,
    });
    const header = container.querySelector("[data-cl-summary-pop-header]");
    expect(header).not.toBeNull();
    // Mono uppercase per spec.
    expect((header!.textContent ?? "").toUpperCase()).toBe(header!.textContent);
    expect(header!.textContent ?? "").toMatch(/SUMMARY/);
    expect(header!.textContent ?? "").toMatch(/TODAY/);
  });
});

describe("SummaryPopover — paint regressions (#25)", () => {
  it("renders zero <a> elements (locks out the nested-anchor regression)", () => {
    // SummaryPopover mounts inside the card's outer <Link to=/agent/:id> — any
    // <a> in the popover tree is invalid HTML and trips real-browser repair
    // races (the outer card navigation can win the click). Same regression #18
    // fixed in RiskMixPopover.
    const { container } = renderPopover({
      summary: "Anchor regression probe.",
      loading: false,
    });
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });

  it("uses the dedicated --cl-bg-popover token for backgroundColor", () => {
    // JSDOM doesn't resolve CSS-var fallback chains against our stylesheet, so
    // we assert the literal var() string. Locks out the prior bug where the
    // fallback chain (--cl-bg-card → --cl-bg) blended into the page canvas.
    const { container } = renderPopover({
      summary: "Background probe.",
      loading: false,
    });
    const pop = container.querySelector<HTMLElement>("[data-cl-summary-popover]");
    expect(pop?.style.backgroundColor).toContain("var(--cl-bg-popover)");
  });

  it("uses the cl-pop-in-up keyframe for entry animation (Linear-style spring, mirrors above-anchored geometry)", () => {
    const { container } = renderPopover({
      summary: "Animation probe.",
      loading: false,
    });
    const pop = container.querySelector<HTMLElement>("[data-cl-summary-popover]");
    expect(pop?.style.animation).toContain("cl-pop-in-up");
  });

  it("caps content at maxHeight: 220px with overflowY: auto (dynamic-up-to-ceiling, scroll past it)", () => {
    // Hybrid display: under the 220px ceiling the popover sizes to its content
    // (no scrollbar visible). Past the ceiling — rare LLM overshoot or longer
    // multi-sentence outputs — the popover scrolls inside its bounds rather
    // than clipping or overflowing the viewport.
    const { container } = renderPopover({
      summary: "Scroll probe.",
      loading: false,
    });
    const pop = container.querySelector<HTMLElement>("[data-cl-summary-popover]");
    expect(pop?.style.maxHeight).toBe("220px");
    expect(pop?.style.overflowY).toBe("auto");
  });
});

describe("SummaryPopover — Open agent footer click-through", () => {
  it("renders an `Open agent →` button (not a link — the popover sits inside the card's outer <a>)", () => {
    const { container } = renderPopover({
      summary: "Footer probe.",
      loading: false,
    });
    const button = container.querySelector<HTMLButtonElement>("button[data-cl-summary-pop-link]");
    expect(button).not.toBeNull();
    expect(button!.textContent ?? "").toMatch(/Open agent/);
  });

  it("navigates to /agent/{agentId} when the button is clicked", () => {
    const { container } = renderPopover({
      summary: "Click-through probe.",
      loading: false,
      agentId: "social-manager",
    });
    const button = container.querySelector<HTMLButtonElement>("button[data-cl-summary-pop-link]")!;
    fireEvent.click(button);
    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(navigateSpy).toHaveBeenCalledWith("/agent/social-manager");
  });

  it("encodes special characters in the agentId path segment", () => {
    const { container } = renderPopover({
      summary: "Encoding probe.",
      loading: false,
      agentId: "alpha/beta",
    });
    const button = container.querySelector<HTMLButtonElement>("button[data-cl-summary-pop-link]")!;
    fireEvent.click(button);
    expect(navigateSpy).toHaveBeenCalledWith("/agent/alpha%2Fbeta");
  });
});

describe("SummaryPopover — dismiss machinery", () => {
  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    renderPopover({ summary: "Escape probe.", loading: false, onClose });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when a click lands outside the popover (mousedown on document body)", () => {
    const onClose = vi.fn();
    renderPopover({ summary: "Outside click probe.", loading: false, onClose });
    // mousedown on body simulates "user clicked elsewhere on the page."
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does NOT call onClose when a click lands inside the popover (clicking content shouldn't dismiss)", () => {
    const onClose = vi.fn();
    const { container } = renderPopover({
      summary: "Inside click probe.",
      loading: false,
      onClose,
    });
    const pop = container.querySelector<HTMLElement>("[data-cl-summary-popover]")!;
    fireEvent.mouseDown(pop);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("removes its document listeners on unmount (no late onClose firings)", () => {
    const onClose = vi.fn();
    const { unmount } = renderPopover({ summary: "Cleanup probe.", loading: false, onClose });
    unmount();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.mouseDown(document.body);
    expect(onClose).not.toHaveBeenCalled();
  });
});
