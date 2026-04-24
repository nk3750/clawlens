// @vitest-environment jsdom
//
// Tests for the two-line LiveFeed row (spec §5), decision-derived tag chips
// (spec §4), empty-state render (spec Case 1), and removal of the absolute
// timestamp column. Complements the legacy chrome assertions in
// live-feed.test.tsx.

import { act, fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class EventSourceShim {
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  readyState = 0;
  close() {}
  addEventListener() {}
  removeEventListener() {}
}
vi.stubGlobal("EventSource", EventSourceShim);

vi.mock("../dashboard/src/hooks/useApi", () => ({
  useApi: vi.fn(),
}));
vi.mock("../dashboard/src/hooks/useSSE", () => ({
  useSSE: vi.fn(),
}));

import LiveFeed from "../dashboard/src/components/LiveFeed";
import { useApi } from "../dashboard/src/hooks/useApi";
import { useSSE } from "../dashboard/src/hooks/useSSE";
import type { EntryResponse } from "../dashboard/src/lib/types";

const mockedUseApi = vi.mocked(useApi);
const mockedUseSSE = vi.mocked(useSSE);

const NOW_ISO = "2026-04-24T12:00:00.000Z";

function entry(partial: Partial<EntryResponse> = {}): EntryResponse {
  return {
    timestamp: NOW_ISO,
    toolName: "read",
    params: { path: "/etc/hosts" },
    effectiveDecision: "allow",
    decision: "allow",
    riskScore: 10,
    category: "exploring",
    agentId: "alpha",
    sessionKey: "agent:alpha:main:s1",
    toolCallId: "tc-1",
    ...partial,
  };
}

function mockInitial(entries: EntryResponse[] | null) {
  mockedUseApi.mockReturnValue({
    data: entries,
    loading: false,
    error: null,
    refetch: vi.fn(),
  });
}

/** Path-aware mock: returns up to `limit` entries based on the
 *  `api/entries?limit=N` query. Used for the §1 View more mechanic where the
 *  path changes on each click (`limit=8` → `limit=16` → `limit=24`). */
function mockLimitAware(all: EntryResponse[]) {
  mockedUseApi.mockImplementation((path: string) => {
    const m = /\?limit=(\d+)/.exec(path);
    const n = m ? Number(m[1]) : all.length;
    return {
      data: all.slice(0, n),
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
  });
}

function renderFeed() {
  return render(
    <MemoryRouter>
      <LiveFeed />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(new Date(NOW_ISO));
  mockedUseSSE.mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────
// Two-line row format (spec §5)
// ─────────────────────────────────────────────────────────────

describe("LiveFeed row — two-line format", () => {
  it("renders a dedicated target line when formatEventTarget is non-empty", () => {
    mockInitial([
      entry({
        toolCallId: "two-line",
        toolName: "read",
        params: { path: "/repo/docs/api/agents.md" },
      }),
    ]);
    const { container } = renderFeed();
    const line2 = container.querySelector(
      '[data-cl-live-feed-row="two-line"] [data-cl-live-feed-target]',
    );
    expect(line2).not.toBeNull();
    expect(line2?.textContent).toBe("/repo/docs/api/agents.md");
  });
  it("does NOT render a target line when formatEventTarget returns empty", () => {
    mockInitial([
      entry({
        toolCallId: "no-line-2",
        toolName: "process",
        params: { action: "poll" },
      }),
    ]);
    const { container } = renderFeed();
    const line2 = container.querySelector(
      '[data-cl-live-feed-row="no-line-2"] [data-cl-live-feed-target]',
    );
    expect(line2).toBeNull();
  });
  it("line 1 contains the verb and tool namespace as separate text nodes", () => {
    mockInitial([
      entry({
        toolCallId: "verb-ns",
        toolName: "write",
        params: { path: "/tmp/out.txt" },
      }),
    ]);
    const { container } = renderFeed();
    const row = container.querySelector('[data-cl-live-feed-row="verb-ns"]');
    expect(row?.textContent).toContain("wrote");
    expect(row?.textContent).toContain("fs.write");
  });
  it("exec rows use shell.{primaryCommand} namespace", () => {
    mockInitial([
      entry({
        toolCallId: "exec-ns",
        toolName: "exec",
        execCategory: "git-read",
        params: { command: "git status" },
      }),
    ]);
    const { container } = renderFeed();
    const row = container.querySelector('[data-cl-live-feed-row="exec-ns"]');
    expect(row?.textContent).toContain("shell.git");
  });
});

// ─────────────────────────────────────────────────────────────
// Absolute timestamp removed (spec §5)
// ─────────────────────────────────────────────────────────────

describe("LiveFeed row — timestamp chrome", () => {
  it("does not render an absolute HH:MM:SS chip per row", () => {
    mockInitial([entry({ toolCallId: "t1" })]);
    const { container } = renderFeed();
    // No visible absolute HH:MM:SS in the row body. Pattern: two-digit
    // hh:mm:ss separated by colons.
    const row = container.querySelector('[data-cl-live-feed-row="t1"]');
    const text = row?.textContent ?? "";
    expect(text).not.toMatch(/\d{2}:\d{2}:\d{2}/);
  });
  it("exposes the ISO timestamp via <a title> for hover recovery", () => {
    mockInitial([entry({ toolCallId: "t-title" })]);
    const { container } = renderFeed();
    const row = container.querySelector<HTMLAnchorElement>('[data-cl-live-feed-row="t-title"]');
    expect(row?.title).toBe(NOW_ISO);
  });
  it("renders a compact relative time (e.g. 1h / 3m — no trailing 'ago')", () => {
    mockInitial([
      entry({
        toolCallId: "rel",
        // 3 minutes ago
        timestamp: new Date(new Date(NOW_ISO).getTime() - 3 * 60_000).toISOString(),
      }),
    ]);
    const { container } = renderFeed();
    const row = container.querySelector('[data-cl-live-feed-row="rel"]');
    expect(row?.textContent).toContain("3m");
    expect(row?.textContent).not.toMatch(/ago/);
  });
});

// ─────────────────────────────────────────────────────────────
// Decision-derived tag chips (spec §4, §5)
// ─────────────────────────────────────────────────────────────

describe("LiveFeed row — decision chips", () => {
  it('renders a "blocked" chip for effectiveDecision=block', () => {
    mockInitial([
      entry({
        toolCallId: "blk",
        toolName: "exec",
        execCategory: "destructive",
        params: { command: "rm -rf /" },
        riskScore: 80,
        effectiveDecision: "block",
        decision: "block",
      }),
    ]);
    const { container } = renderFeed();
    const pills = container.querySelectorAll('[data-cl-live-feed-row="blk"] .cl-pill');
    const texts = Array.from(pills).map((p) => p.textContent?.toLowerCase() ?? "");
    expect(texts.some((t) => t.includes("blocked"))).toBe(true);
  });
  it('renders a "timeout" chip for effectiveDecision=timeout and tints it red (danger)', () => {
    mockInitial([
      entry({
        toolCallId: "to",
        toolName: "exec",
        execCategory: "destructive",
        params: { command: "rm -rf /" },
        riskScore: 80,
        effectiveDecision: "timeout",
        decision: "approval_required",
      }),
    ]);
    const { container } = renderFeed();
    const pills = container.querySelectorAll('[data-cl-live-feed-row="to"] .cl-pill');
    const timeoutPill = Array.from(pills).find((p) =>
      p.textContent?.toLowerCase().includes("timeout"),
    );
    expect(timeoutPill).toBeDefined();
    // Timeout is a decision signal — must be red-tinted per §5.
    const color = (timeoutPill as HTMLElement | undefined)?.style.color ?? "";
    expect(color).toMatch(/cl-risk-high|risk-high/);
  });
  it('renders a "pending" chip (neutral, no danger tint) for pending decisions', () => {
    mockInitial([
      entry({
        toolCallId: "pn",
        effectiveDecision: "pending",
        decision: "approval_required",
      }),
    ]);
    const { container } = renderFeed();
    const pills = container.querySelectorAll('[data-cl-live-feed-row="pn"] .cl-pill');
    const pendingPill = Array.from(pills).find((p) =>
      p.textContent?.toLowerCase().includes("pending"),
    );
    expect(pendingPill).toBeDefined();
    const color = (pendingPill as HTMLElement | undefined)?.style.color ?? "";
    // Pending is neutral (muted), not danger.
    expect(color).not.toMatch(/cl-risk-high|risk-high/);
  });
});

// ─────────────────────────────────────────────────────────────
// Empty state (spec Case 1)
// ─────────────────────────────────────────────────────────────

describe("LiveFeed row — empty state", () => {
  it("renders the header + a No recent activity row instead of returning null", () => {
    mockInitial([]);
    const { container } = renderFeed();
    // Header still present
    const section = container.querySelector("[data-cl-live-feed]");
    expect(section).not.toBeNull();
    // Empty row is visible
    const empty = container.querySelector("[data-cl-live-feed-empty]");
    expect(empty).not.toBeNull();
    expect(empty?.textContent?.toLowerCase()).toContain("no recent");
  });
});

// ─────────────────────────────────────────────────────────────
// Polish-2 §1 — View more mechanic, fixed-height card, 24 cap
// ─────────────────────────────────────────────────────────────

describe("LiveFeed — polish-2 §1 chrome", () => {
  it("does NOT render the N-events counter in the header", () => {
    mockInitial([entry({ toolCallId: "a" })]);
    const { container } = renderFeed();
    const header = container.querySelector("[data-cl-live-feed] > div");
    // Counter was dropped in polish-1 §1.1 and STAYS dropped (polish-2 §1.7).
    expect(header?.textContent ?? "").not.toMatch(/event/i);
  });
  it("wraps the row list in a scrollable inner container", () => {
    mockInitial([entry({ toolCallId: "a" })]);
    const { container } = renderFeed();
    const scroll = container.querySelector<HTMLElement>("[data-cl-live-feed-scroll]");
    expect(scroll).not.toBeNull();
    expect(scroll?.style.overflowY).toBe("auto");
  });
  it("outer section caps its height at 580px (polish-2 §3.5 belt-and-suspenders)", () => {
    mockInitial([entry({ toolCallId: "a" })]);
    const { container } = renderFeed();
    const section = container.querySelector<HTMLElement>("[data-cl-live-feed]");
    expect(section?.style.maxHeight).toBe("580px");
  });
  it("renders the LIVE header INSIDE the cl-card (polish-3 #4 alignment)", () => {
    // Before polish-3 the LIVE label + pulse dot sat OUTSIDE the card as a
    // floating header, which pushed the whole card down relative to the
    // FleetRiskTile next door. Header must now live inside the card as its
    // first child so both tiles' card-tops align at the grid-cell top.
    mockInitial([entry({ toolCallId: "header-inside" })]);
    const { container } = renderFeed();
    const card = container.querySelector<HTMLElement>("[data-cl-live-feed-list]");
    expect(card).not.toBeNull();
    const liveLabel = Array.from(card?.querySelectorAll("span") ?? []).find(
      (s) => s.textContent?.trim().toLowerCase() === "live",
    );
    expect(liveLabel).toBeDefined();
  });
  it("LIVE header has a borderBottom separator from the scroll area", () => {
    mockInitial([entry({ toolCallId: "border-check" })]);
    const { container } = renderFeed();
    const header = container.querySelector<HTMLElement>("[data-cl-live-feed-header]");
    expect(header).not.toBeNull();
    expect(header?.style.borderBottom).toMatch(/1px solid/);
  });
  it("card is the first child of the outer section — no floating header before it", () => {
    mockInitial([entry({ toolCallId: "first-child" })]);
    const { container } = renderFeed();
    const section = container.querySelector<HTMLElement>("[data-cl-live-feed]");
    const firstChild = section?.firstElementChild;
    expect(firstChild?.getAttribute("data-cl-live-feed-list")).not.toBeNull();
  });
  it("renders 8 rows initially (INITIAL_LIMIT), not the old 25", () => {
    const entries = Array.from({ length: 40 }, (_, i) =>
      entry({ toolCallId: `e-${i}`, timestamp: NOW_ISO }),
    );
    mockLimitAware(entries);
    const { container } = renderFeed();
    const rows = container.querySelectorAll("[data-cl-live-feed-row]");
    expect(rows.length).toBe(8);
  });
  it("rows use tight 8px vertical padding (polish-2 §3.4) so 8 fit in 580px", () => {
    mockInitial([entry({ toolCallId: "padding-check" })]);
    const { container } = renderFeed();
    const row = container.querySelector<HTMLElement>('[data-cl-live-feed-row="padding-check"]');
    expect(row?.style.padding).toBe("8px 14px");
  });
  it('renders a "View more" button when rendered count < CAP', () => {
    const entries = Array.from({ length: 40 }, (_, i) =>
      entry({ toolCallId: `e-${i}`, timestamp: NOW_ISO }),
    );
    mockLimitAware(entries);
    const { container } = renderFeed();
    const btn = container.querySelector<HTMLButtonElement>("[data-cl-live-feed-viewmore]");
    expect(btn).not.toBeNull();
    expect(btn?.tagName.toLowerCase()).toBe("button");
    expect(btn?.textContent?.toLowerCase()).toContain("view more");
    // And the "View all in Activity" link is NOT yet shown — that's for the
    // at-cap state.
    expect(container.querySelector("[data-cl-live-feed-viewall]")).toBeNull();
  });
  it("click on View more fetches the next page and renders 16 rows", () => {
    const entries = Array.from({ length: 40 }, (_, i) =>
      entry({ toolCallId: `e-${i}`, timestamp: NOW_ISO }),
    );
    mockLimitAware(entries);
    const { container } = renderFeed();
    const btn = container.querySelector<HTMLButtonElement>("[data-cl-live-feed-viewmore]");
    expect(btn).not.toBeNull();
    if (!btn) return;
    act(() => {
      fireEvent.click(btn);
    });
    // useApi mock is synchronous + path-aware; setPageSize re-renders the
    // component, the new `limit=16` path resolves immediately in the same
    // act() flush. No waitFor — fake timers in beforeEach would starve it.
    expect(container.querySelectorAll("[data-cl-live-feed-row]").length).toBe(16);
    expect(container.querySelector("[data-cl-live-feed-viewmore]")).not.toBeNull();
    expect(container.querySelector("[data-cl-live-feed-viewall]")).toBeNull();
  });
  it("second click lands at 24 rows + footer flips to 'View all in Activity →' link", () => {
    const entries = Array.from({ length: 40 }, (_, i) =>
      entry({ toolCallId: `e-${i}`, timestamp: NOW_ISO }),
    );
    mockLimitAware(entries);
    const { container } = renderFeed();
    act(() => {
      fireEvent.click(container.querySelector("[data-cl-live-feed-viewmore]") as Element);
    });
    expect(container.querySelectorAll("[data-cl-live-feed-row]").length).toBe(16);
    act(() => {
      fireEvent.click(container.querySelector("[data-cl-live-feed-viewmore]") as Element);
    });
    expect(container.querySelectorAll("[data-cl-live-feed-row]").length).toBe(24);
    // Footer has flipped: no more View more button; a Link to /activity
    // takes its place.
    expect(container.querySelector("[data-cl-live-feed-viewmore]")).toBeNull();
    const link = container.querySelector<HTMLAnchorElement>("[data-cl-live-feed-viewall]");
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toBe("/activity");
    expect(link?.textContent?.toLowerCase()).toContain("view all");
  });
  it("omits BOTH footer elements when the list is empty", () => {
    mockInitial([]);
    const { container } = renderFeed();
    expect(container.querySelector("[data-cl-live-feed-viewmore]")).toBeNull();
    expect(container.querySelector("[data-cl-live-feed-viewall]")).toBeNull();
  });
});
