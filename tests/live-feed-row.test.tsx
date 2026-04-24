// @vitest-environment jsdom
//
// Tests for the two-line LiveFeed row (spec §5), decision-derived tag chips
// (spec §4), empty-state render (spec Case 1), and removal of the absolute
// timestamp column. Complements the legacy chrome assertions in
// live-feed.test.tsx.

import { render } from "@testing-library/react";
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
