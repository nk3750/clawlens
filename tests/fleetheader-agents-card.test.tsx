// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it } from "vitest";
import AgentsRunningCard, {
  PIP_CAP,
} from "../dashboard/src/components/fleetheader/AgentsRunningCard";

/**
 * stat-cards-revamp-spec §4.2 + §6.2 — Agents Running card replaces the
 * "/{pct}%" slash with a pip strip. Tests reference PIP_CAP from the module
 * (live-walk tunable) rather than hardcoding values.
 *
 * Synthetic data only — do NOT lift any pixel/scenario values from the
 * design mock.
 */

function renderCard(props: ComponentProps<typeof AgentsRunningCard>) {
  return render(<AgentsRunningCard {...props} />);
}

function pipsInOrder(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-cl-pip]"));
}

function pipState(pip: HTMLElement): string | null {
  return pip.getAttribute("data-cl-pip-state");
}

function bigNumberText(): string {
  return document.querySelector("[data-cl-agents-big]")?.textContent ?? "";
}

function sublabelText(): string {
  return document.querySelector("[data-cl-agents-sublabel]")?.textContent ?? "";
}

function secondaryText(): string {
  return document.querySelector("[data-cl-agents-secondary]")?.textContent ?? "";
}

function pipStrip(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-cl-pip-strip]");
}

// ── Tests ─────────────────────────────────────────────────────────

describe("AgentsRunningCard — text rendering", () => {
  it("renders big number = active and sublabel = 'of {total}'", () => {
    renderCard({ active: 5, activeSessions: 3, total: 14 });
    expect(bigNumberText()).toBe("5");
    expect(sublabelText()).toBe("of 14");
  });

  it("renders three-bucket secondary text always (running / between / idle)", () => {
    renderCard({ active: 5, activeSessions: 3, total: 14 });
    // running=3 (sessions), between=2 (active − running), idle=9 (total − active)
    expect(secondaryText()).toBe("3 running · 2 between · 9 idle");
  });

  it("keeps all three buckets visible even when one is zero", () => {
    renderCard({ active: 4, activeSessions: 4, total: 4 });
    // running=4, between=0, idle=0 — all three buckets still rendered
    expect(secondaryText()).toBe("4 running · 0 between · 0 idle");
  });

  it("renders 0 running · 0 between · 0 idle when total === 0", () => {
    renderCard({ active: 0, activeSessions: 0, total: 0 });
    expect(bigNumberText()).toBe("0");
    expect(secondaryText()).toBe("0 running · 0 between · 0 idle");
  });
});

describe("AgentsRunningCard — pip strip presence", () => {
  it("omits the pip strip entirely when total === 0", () => {
    renderCard({ active: 0, activeSessions: 0, total: 0 });
    expect(pipStrip()).toBeNull();
    expect(pipsInOrder().length).toBe(0);
  });

  it("renders the pip strip when total > 0", () => {
    renderCard({ active: 0, activeSessions: 0, total: 1 });
    expect(pipStrip()).not.toBeNull();
  });
});

describe("AgentsRunningCard — 1:1 mode (total <= PIP_CAP)", () => {
  it("renders exactly `total` pips when total <= PIP_CAP", () => {
    const total = Math.max(1, PIP_CAP - 2);
    renderCard({ active: 1, activeSessions: 1, total });
    expect(pipsInOrder().length).toBe(total);
  });

  it("colors the first `active` pips green and the rest dim", () => {
    const total = Math.max(2, PIP_CAP - 4);
    const active = Math.max(1, Math.floor(total / 2));
    renderCard({ active, activeSessions: active, total });
    const states = pipsInOrder().map(pipState);
    expect(states.length).toBe(total);
    expect(states.slice(0, active).every((s) => s === "active")).toBe(true);
    expect(states.slice(active).every((s) => s === "idle")).toBe(true);
  });

  it("renders all pips dim when active === 0", () => {
    const total = Math.max(1, PIP_CAP - 1);
    renderCard({ active: 0, activeSessions: 0, total });
    const states = pipsInOrder().map(pipState);
    expect(states.length).toBe(total);
    expect(states.every((s) => s === "idle")).toBe(true);
  });

  it("renders all pips green when active === total", () => {
    const total = Math.max(1, PIP_CAP - 1);
    renderCard({ active: total, activeSessions: total, total });
    const states = pipsInOrder().map(pipState);
    expect(states.length).toBe(total);
    expect(states.every((s) => s === "active")).toBe(true);
  });

  it("uses 1:1 path at the boundary total === PIP_CAP", () => {
    renderCard({ active: 1, activeSessions: 1, total: PIP_CAP });
    expect(pipsInOrder().length).toBe(PIP_CAP);
  });
});

describe("AgentsRunningCard — proportional mode (total > PIP_CAP)", () => {
  it("renders exactly PIP_CAP pips when total > PIP_CAP", () => {
    const total = PIP_CAP * 5;
    renderCard({ active: total, activeSessions: total, total });
    expect(pipsInOrder().length).toBe(PIP_CAP);
  });

  it("greens Math.round(active/total*PIP_CAP) pips at scale", () => {
    // active = 50% of total, total well above PIP_CAP. Expect ~half the pips green.
    const total = PIP_CAP * 4;
    const active = total / 2;
    renderCard({ active, activeSessions: active, total });
    const states = pipsInOrder().map(pipState);
    const greenCount = states.filter((s) => s === "active").length;
    expect(greenCount).toBe(Math.round((active / total) * PIP_CAP));
  });

  it("renders all PIP_CAP pips dim when active === 0", () => {
    const total = PIP_CAP * 3;
    renderCard({ active: 0, activeSessions: 0, total });
    const states = pipsInOrder().map(pipState);
    expect(states.length).toBe(PIP_CAP);
    expect(states.every((s) => s === "idle")).toBe(true);
  });

  it("renders all PIP_CAP pips green when active === total", () => {
    const total = PIP_CAP * 3;
    renderCard({ active: total, activeSessions: total, total });
    const states = pipsInOrder().map(pipState);
    expect(states.length).toBe(PIP_CAP);
    expect(states.every((s) => s === "active")).toBe(true);
  });

  it("guarantees at least 1 green pip when active > 0 but rounding would yield 0", () => {
    // active is so small that round(active/total*PIP_CAP) = 0 mathematically.
    // total ≥ PIP_CAP*200 keeps the share well below 0.5/PIP_CAP at any
    // reasonable PIP_CAP, so the guard fires.
    const total = PIP_CAP * 200;
    renderCard({ active: 1, activeSessions: 1, total });
    const states = pipsInOrder().map(pipState);
    expect(states.length).toBe(PIP_CAP);
    const greenCount = states.filter((s) => s === "active").length;
    expect(greenCount).toBeGreaterThanOrEqual(1);
  });
});

describe("AgentsRunningCard — a11y", () => {
  it("wraps the pip strip in a role='img' element with a generated aria-label", () => {
    renderCard({ active: 5, activeSessions: 3, total: 14 });
    const strip = pipStrip();
    expect(strip).not.toBeNull();
    const role = (strip as HTMLElement).getAttribute("role");
    expect(role).toBe("img");
    const label = (strip as HTMLElement).getAttribute("aria-label") ?? "";
    expect(label).toContain("5");
    expect(label).toContain("14");
  });

  it("renders the AGENTS RUNNING label-mono header", () => {
    renderCard({ active: 5, activeSessions: 3, total: 14 });
    expect(screen.getByText(/AGENTS RUNNING/i)).toBeDefined();
  });
});
