// @vitest-environment jsdom

// Stage D §D6 — LiveFeed re-skin. Preserve ALL existing wiring (SSE, reducer,
// newIds, describeEntry, deriveTags, GradientAvatar) and assert the new
// Linear-adjacent chrome:
//   • container uses .cl-card
//   • new SSE rows get the shared .entry-flash class (indigo tint, not amber)
//   • tags render as .cl-pill uppercase-mono chips
//   • attention-flagged entries carry the riskLeftBorder inset shadow
//   • no inline amber rgba(212, 165, 116, ...) remains

import { act, render } from "@testing-library/react";
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

const NOW_ISO = "2026-04-20T12:00:00.000Z";

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

describe("LiveFeed — Linear-adjacent chrome (§D6)", () => {
  it("wraps the entry list in a .cl-card container", () => {
    mockInitial([entry({ toolCallId: "a" })]);
    const { container } = renderFeed();
    const card = container.querySelector("[data-cl-live-feed-list]");
    expect(card).not.toBeNull();
    expect(card?.className ?? "").toMatch(/\bcl-card\b/);
  });

  it("uses no inline amber rgba(212, 165, 116, …) on backgrounds (GradientAvatar palette is allowed)", () => {
    // The amber we want to block is the legacy flash background
    // `rgba(212, 165, 116, 0.06)` — not the same 212/165/116 channel that
    // appears in the GradientAvatar palette hex (#d4a574). Scan only the
    // backgroundColor slot to avoid false positives on gradient fills.
    mockInitial([entry({ toolCallId: "a" }), entry({ toolCallId: "b" })]);
    const { container } = renderFeed();
    for (const el of Array.from(container.querySelectorAll<HTMLElement>("[style]"))) {
      const bg = el.style.backgroundColor ?? "";
      expect(bg).not.toMatch(/212,\s*165,\s*116/);
    }
  });
});

describe("LiveFeed — new-entry flash animation", () => {
  it("applies the shared .entry-flash class to a row that just arrived via SSE", () => {
    mockInitial([]);
    let sseCallback: ((e: EntryResponse) => void) | null = null;
    mockedUseSSE.mockImplementation((_path, cb) => {
      sseCallback = cb as (e: EntryResponse) => void;
      return undefined;
    });

    const { container } = renderFeed();
    expect(sseCallback).not.toBeNull();
    const fresh = entry({
      toolCallId: "fresh-1",
      timestamp: NOW_ISO,
    });
    act(() => {
      sseCallback?.(fresh);
    });
    // The row we just pushed must carry .entry-flash (spec — the motion
    // primitive #2, decays to transparent over 1.5s).
    const flashed = container.querySelectorAll(".entry-flash");
    expect(flashed.length).toBeGreaterThan(0);
  });
});

describe("LiveFeed — tag chips (§D6 .cl-pill uppercase-mono)", () => {
  it("renders deriveTags() output as .cl-pill chips", () => {
    // toolName 'read' → deriveTags() returns ['file-read']; this must surface
    // inside the row as a .cl-pill.
    mockInitial([
      entry({
        toolCallId: "with-tag",
        toolName: "read",
        params: { path: "/tmp/x" },
      }),
    ]);
    const { container } = renderFeed();
    const pill = container.querySelector(".cl-pill");
    expect(pill).not.toBeNull();
    // Pill is uppercase — deriveTags emits lowercase so the uppercase
    // transform must come from the .cl-pill utility itself. The uppercase
    // style comes from the CSS class, but we can check the pill has role/text.
    expect(pill?.textContent?.trim().length ?? 0).toBeGreaterThan(0);
  });

  it("renders multiple pills when a destructive exec produces multiple tags", () => {
    mockInitial([
      entry({
        toolCallId: "destr",
        toolName: "exec",
        params: { command: "rm -rf /" },
        execCategory: "destructive",
        riskScore: 80,
        riskTags: ["destructive", "file-delete"],
      }),
    ]);
    const { container } = renderFeed();
    const pills = container.querySelectorAll(".cl-pill");
    expect(pills.length).toBeGreaterThanOrEqual(2);
  });
});

describe("LiveFeed — attention-flagged entries", () => {
  it("adds an inset left-border shadow on high-risk rows (via riskLeftBorder)", () => {
    // score 70 → high tier → riskLeftBorder returns `inset 3px 0 0 0 <color>`
    mockInitial([
      entry({
        toolCallId: "hi",
        toolName: "exec",
        params: { command: "rm -rf /" },
        execCategory: "destructive",
        riskScore: 70,
      }),
    ]);
    const { container } = renderFeed();
    const row = container.querySelector<HTMLElement>('[data-cl-live-feed-row="hi"]');
    expect(row).not.toBeNull();
    const shadow = row?.style.boxShadow ?? "";
    expect(shadow).toMatch(/inset/);
    expect(shadow).toMatch(/3px/);
  });

  it("adds an inset soft-green left-border shadow on low-risk rows (~40% alpha) — regression-lock for #24", () => {
    // score 10 → low tier → riskLeftBorder returns `inset 3px 0 0 0 #4ade8066`.
    // 40% alpha (66 hex) is intentionally softer than the 70% high-tier ribbon
    // — communicates "healthy" rather than "concerning at any level". The
    // four tier branches now render parallel ribbons; the dot+ribbon
    // composition stays consistent across low/medium/high/critical.
    mockInitial([
      entry({
        toolCallId: "lo",
        riskScore: 10,
      }),
    ]);
    const { container } = renderFeed();
    const row = container.querySelector<HTMLElement>('[data-cl-live-feed-row="lo"]');
    expect(row).not.toBeNull();
    const shadow = row?.style.boxShadow ?? "";
    expect(shadow).toMatch(/inset/);
    expect(shadow).toMatch(/3px/);
    // Tier-resolved low-risk color (#4ade80) + 40%-alpha hex (66)
    expect(shadow).toMatch(/4ade8066/i);
  });
});
