// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it } from "vitest";
import PendingCard from "../dashboard/src/components/fleetheader/PendingCard";

/**
 * stat-cards-revamp-spec §4.3 + §6.3 — Pending Approval card.
 *
 * Two surgical changes from the previous inline rendering:
 *   1. big-number color escalates on count > 0 (accent vs muted)
 *   2. empty-state secondary line gets a green ✓ glyph + "nothing waiting"
 *
 * Existing agent-name rendering and the "X actions waiting" fallback are
 * regression-guarded here. Synthetic data only.
 */

function renderCard(props: ComponentProps<typeof PendingCard>) {
  return render(<PendingCard {...props} />);
}

function bigNumber(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-cl-pending-big]");
}

function secondaryWrapper(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-cl-pending-secondary]");
}

// ── Tests ─────────────────────────────────────────────────────────

describe("PendingCard — empty state (count === 0)", () => {
  it("marks the card as empty so the big-number color resolves to muted", () => {
    renderCard({ count: 0, agentNames: [] });
    const big = bigNumber();
    expect(big).not.toBeNull();
    expect(big?.getAttribute("data-cl-empty")).toBe("true");
    // Inline color uses the muted token.
    expect(big?.style.color).toContain("--cl-text-muted");
  });

  it("renders a green check glyph + 'nothing waiting' in the secondary line", () => {
    renderCard({ count: 0, agentNames: [] });
    const secondary = secondaryWrapper();
    expect(secondary).not.toBeNull();
    // Affirmative copy + risk-low color on the wrapper for the ALL-CLEAR cue.
    expect(secondary?.textContent).toContain("nothing waiting");
    expect(secondary?.style.color).toContain("--cl-risk-low");
    // Inline check-glyph SVG.
    const svg = secondary?.querySelector("svg");
    expect(svg).not.toBeNull();
  });
});

describe("PendingCard — escalated state (count > 0)", () => {
  it("marks the card as non-empty so the big-number color resolves to accent", () => {
    renderCard({ count: 3, agentNames: [] });
    const big = bigNumber();
    expect(big).not.toBeNull();
    expect(big?.getAttribute("data-cl-empty")).toBe("false");
    expect(big?.style.color).toContain("--cl-accent");
  });

  it("does not render the green check glyph when count > 0", () => {
    renderCard({ count: 3, agentNames: [] });
    const secondary = secondaryWrapper();
    expect(secondary?.querySelector("svg")).toBeNull();
  });
});

describe("PendingCard — secondary line: agent name list (regression)", () => {
  it("renders both names joined by ' · ' when 2 names are passed", () => {
    renderCard({ count: 2, agentNames: ["alice", "bob"] });
    expect(secondaryWrapper()?.textContent).toContain("alice · bob");
  });

  it("caps at 2 names and renders ' · +N more' suffix for the rest", () => {
    renderCard({ count: 4, agentNames: ["alice", "bob", "carol", "dave"] });
    expect(secondaryWrapper()?.textContent).toContain("alice · bob · +2 more");
  });

  it("dedupes repeated names before applying the cap", () => {
    renderCard({ count: 4, agentNames: ["alice", "alice", "bob", "carol"] });
    // After dedupe: alice, bob, carol → shown=[alice, bob], extra=1.
    expect(secondaryWrapper()?.textContent).toContain("alice · bob · +1 more");
  });
});

describe("PendingCard — secondary line: count fallback (regression)", () => {
  it("renders '1 action waiting' when count === 1 and agentNames is empty", () => {
    renderCard({ count: 1, agentNames: [] });
    expect(secondaryWrapper()?.textContent).toBe("1 action waiting");
  });

  it("renders '{count} actions waiting' (plural) when count > 1 and agentNames is empty", () => {
    renderCard({ count: 7, agentNames: [] });
    expect(secondaryWrapper()?.textContent).toBe("7 actions waiting");
  });
});

describe("PendingCard — interaction surface", () => {
  it("renders no <button> roots and no CTA pill", () => {
    renderCard({ count: 5, agentNames: ["alice", "bob"] });
    const buttons = screen.queryAllByRole("button");
    expect(buttons.length).toBe(0);
  });

  it("renders the 'PENDING APPROVAL' label-mono header", () => {
    renderCard({ count: 0, agentNames: [] });
    expect(screen.getByText(/PENDING APPROVAL/i)).toBeDefined();
  });
});
