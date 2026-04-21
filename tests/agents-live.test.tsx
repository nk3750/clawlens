// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mock useLiveApi so we can assert which paths Agents.tsx subscribes to and
 * exercise the attention filter predicate independently of the network/SSE
 * layer. Also mock useApi (for any nested-component subscriptions like
 * ActivityTimeline) so the homepage renders without booting EventSource.
 */
vi.mock("../dashboard/src/hooks/useLiveApi", () => ({
  useLiveApi: vi.fn(),
}));
vi.mock("../dashboard/src/hooks/useApi", () => ({
  useApi: vi.fn(() => ({ data: null, loading: false, error: null, refetch: vi.fn() })),
}));
vi.mock("../dashboard/src/hooks/useSSE", () => ({
  useSSE: vi.fn(),
}));

import { useLiveApi } from "../dashboard/src/hooks/useLiveApi";
import type { EntryResponse } from "../dashboard/src/lib/types";
import Agents from "../dashboard/src/pages/Agents";

const mockedUseLiveApi = vi.mocked(useLiveApi);

function defaultLiveApiReturn() {
  return {
    data: null,
    loading: false,
    error: null,
    refetch: vi.fn(),
  };
}

function fakeEntry(overrides: Partial<EntryResponse> = {}): EntryResponse {
  return {
    timestamp: "2026-04-18T12:00:00.000Z",
    toolName: "exec",
    params: {},
    effectiveDecision: "allow",
    decision: "allow",
    riskScore: 30,
    category: "commands",
    ...overrides,
  };
}

beforeEach(() => {
  mockedUseLiveApi.mockImplementation(() => defaultLiveApiReturn());
});

afterEach(() => {
  vi.clearAllMocks();
});

function renderHome() {
  return render(
    <MemoryRouter>
      <Agents />
    </MemoryRouter>,
  );
}

describe("Agents homepage — useLiveApi subscriptions", () => {
  it("subscribes to three homepage endpoints via useLiveApi", () => {
    // Phase 2 stage B dropped the /api/guardrails subscription along with the
    // OverflowMenu that consumed its count. Guardrails management still lives
    // on /guardrails and wires its own fetch there.
    renderHome();
    const paths = mockedUseLiveApi.mock.calls.map((call) => call[0]);
    expect(paths).toContain("api/stats");
    expect(paths).toContain("api/agents");
    // attention path includes optional ?date= suffix; today (default) has none.
    expect(paths.some((p) => p.startsWith("api/attention"))).toBe(true);
    expect(paths).not.toContain("api/guardrails");
    expect(paths).toHaveLength(3);
  });

  it("passes a filter predicate only on the attention subscription", () => {
    renderHome();
    const calls = mockedUseLiveApi.mock.calls;
    const attentionCall = calls.find((c) => String(c[0]).startsWith("api/attention"));
    expect(attentionCall).toBeDefined();
    expect(attentionCall?.[1]).toBeDefined();
    expect(typeof attentionCall?.[1]?.filter).toBe("function");

    // The other three have no options (or no filter).
    const others = calls.filter((c) => !String(c[0]).startsWith("api/attention"));
    for (const c of others) {
      expect(c[1]?.filter).toBeUndefined();
    }
  });
});

describe("Agents homepage — attention filter predicate", () => {
  function attentionFilter(): (e: EntryResponse) => boolean {
    renderHome();
    const attentionCall = mockedUseLiveApi.mock.calls.find((c) =>
      String(c[0]).startsWith("api/attention"),
    );
    if (!attentionCall) throw new Error("attention subscription missing");
    const fn = attentionCall[1]?.filter;
    if (!fn) throw new Error("attention filter missing");
    return fn;
  }

  it("admits pending entries", () => {
    expect(attentionFilter()(fakeEntry({ effectiveDecision: "pending" }))).toBe(true);
  });

  it("admits block entries", () => {
    expect(attentionFilter()(fakeEntry({ effectiveDecision: "block" }))).toBe(true);
  });

  it("admits timeout entries", () => {
    expect(attentionFilter()(fakeEntry({ effectiveDecision: "timeout" }))).toBe(true);
  });

  it("admits high-risk allow entries (score >= 65)", () => {
    expect(attentionFilter()(fakeEntry({ effectiveDecision: "allow", riskScore: 70 }))).toBe(true);
  });

  it("admits exactly at the high-risk threshold (score == 65)", () => {
    expect(attentionFilter()(fakeEntry({ effectiveDecision: "allow", riskScore: 65 }))).toBe(true);
  });

  it("rejects low-risk allow entries (score < 65)", () => {
    expect(attentionFilter()(fakeEntry({ effectiveDecision: "allow", riskScore: 30 }))).toBe(false);
  });

  it("rejects allow entries with no riskScore (treated as 0)", () => {
    expect(attentionFilter()(fakeEntry({ effectiveDecision: "allow", riskScore: undefined }))).toBe(
      false,
    );
  });
});
