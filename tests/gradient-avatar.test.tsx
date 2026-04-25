// @vitest-environment jsdom

// agent-grid-polish §2(b) — GradientAvatar renders the agent's first 1 or 2
// characters (uppercased) inside the gradient circle. Sans for 1-letter,
// mono for 2-letter. Letter is decoration (aria-hidden); agent name is
// announced separately by the surrounding card.

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import GradientAvatar from "../dashboard/src/components/GradientAvatar";

function letterSpan(container: HTMLElement): HTMLElement | null {
  // The avatar's outer div carries the linear-gradient inline style; the
  // letter span sits inside it. Query the outer div first to avoid catching
  // any other span the surrounding harness might inject.
  const outer = Array.from(container.querySelectorAll<HTMLElement>("div")).find((el) =>
    el.style.background?.includes("linear-gradient"),
  );
  return outer?.querySelector<HTMLElement>("span") ?? null;
}

describe("GradientAvatar — initial letter (1-letter mode, default)", () => {
  it("renders the first character of agentId, uppercased", () => {
    const { container } = render(<GradientAvatar agentId="baddie" size="xs" />);
    expect(letterSpan(container)?.textContent).toBe("B");
  });

  it("uppercases lowercase ids", () => {
    const { container } = render(<GradientAvatar agentId="seo-growth" size="xs" />);
    expect(letterSpan(container)?.textContent).toBe("S");
  });

  it("preserves digits as-is for numeric-prefix ids", () => {
    const { container } = render(<GradientAvatar agentId="9-watcher" size="xs" />);
    expect(letterSpan(container)?.textContent).toBe("9");
  });

  it("falls back to '?' when agentId is empty", () => {
    const { container } = render(<GradientAvatar agentId="" size="xs" />);
    expect(letterSpan(container)?.textContent).toBe("?");
  });

  it("uses sans font-family", () => {
    const { container } = render(<GradientAvatar agentId="alpha" size="xs" />);
    expect(letterSpan(container)?.style.fontFamily ?? "").toContain("--cl-font-sans");
  });

  it("scales font-size as max(8, round(px * 0.45)) at every avatar size", () => {
    const cases: { size: "xs" | "sm" | "md" | "lg"; px: number }[] = [
      { size: "xs", px: 20 },
      { size: "sm", px: 32 },
      { size: "md", px: 44 },
      { size: "lg", px: 60 },
    ];
    for (const { size, px } of cases) {
      const { container, unmount } = render(<GradientAvatar agentId="alpha" size={size} />);
      const expected = Math.max(8, Math.round(px * 0.45));
      expect(letterSpan(container)?.style.fontSize, size).toBe(`${expected}px`);
      unmount();
    }
  });
});

describe("GradientAvatar — initial letter (2-letter mode)", () => {
  it("renders the first 2 characters of agentId, uppercased", () => {
    const { container } = render(<GradientAvatar agentId="baddie" size="xs" letterCount={2} />);
    expect(letterSpan(container)?.textContent).toBe("BA");
  });

  it("uses mono font-family in 2-letter mode (uniform width fits the circle)", () => {
    const { container } = render(<GradientAvatar agentId="baddie" size="xs" letterCount={2} />);
    expect(letterSpan(container)?.style.fontFamily ?? "").toContain("--cl-font-mono");
  });

  it("scales font-size as max(7, round(px * 0.35)) at every avatar size", () => {
    const cases: { size: "xs" | "sm" | "md" | "lg"; px: number }[] = [
      { size: "xs", px: 20 },
      { size: "sm", px: 32 },
      { size: "md", px: 44 },
      { size: "lg", px: 60 },
    ];
    for (const { size, px } of cases) {
      const { container, unmount } = render(
        <GradientAvatar agentId="alpha" size={size} letterCount={2} />,
      );
      const expected = Math.max(7, Math.round(px * 0.35));
      expect(letterSpan(container)?.style.fontSize, size).toBe(`${expected}px`);
      unmount();
    }
  });

  it("with a 1-character agentId, gracefully renders just that one char", () => {
    // slice(0, 2) on a 1-char string returns the 1 char. No crash, no padding.
    const { container } = render(<GradientAvatar agentId="x" size="xs" letterCount={2} />);
    expect(letterSpan(container)?.textContent).toBe("X");
  });

  it("preserves the leading 2 characters of a numeric-prefix id", () => {
    const { container } = render(<GradientAvatar agentId="9-watcher" size="xs" letterCount={2} />);
    expect(letterSpan(container)?.textContent).toBe("9-");
  });
});

describe("GradientAvatar — accessibility + structural invariants", () => {
  it("marks the letter span aria-hidden=true (avatar is decoration; the agent name is announced separately)", () => {
    const { container } = render(<GradientAvatar agentId="baddie" />);
    expect(letterSpan(container)?.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders a 135° two-stop linear-gradient from agentGradient on the outer surface", () => {
    // JSDOM normalizes hsl(...) → rgb(...) when storing inline styles, so the
    // HSL value-lock lives in dashboard-utils.test.ts. Here we just assert the
    // avatar surface uses agentGradient (two distinct color stops at 135°).
    const { container } = render(<GradientAvatar agentId="baddie" />);
    const outer = Array.from(container.querySelectorAll<HTMLElement>("div")).find((el) =>
      el.style.background?.includes("linear-gradient"),
    );
    const bg = outer?.style.background ?? "";
    expect(bg).toMatch(/linear-gradient\(135deg,/);
    const colorMatches = bg.match(/rgb\([^)]+\)/g) ?? [];
    expect(colorMatches.length).toBe(2);
    expect(colorMatches[0]).not.toBe(colorMatches[1]);
  });
});
