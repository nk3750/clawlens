// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted mock so each test can shape the useSessionSummary return value
// without re-mocking the module. SessionHeader reads {summary, summaryKind,
// isLlmGenerated, loading, generate} — exercise each shape independently.
const useSessionSummaryMock = vi.hoisted(() =>
  vi.fn(() => ({
    summary: null as string | null,
    summaryKind: undefined as "llm" | "template" | "disabled" | "degraded_no_key" | undefined,
    isLlmGenerated: false,
    loading: false,
    generate: vi.fn(),
  })),
);
vi.mock("../dashboard/src/hooks/useSessionSummary", () => ({
  useSessionSummary: useSessionSummaryMock,
}));

import SessionHeader from "../dashboard/src/components/SessionHeader";
import type { SessionInfo } from "../dashboard/src/lib/types";

function makeSession(partial: Partial<SessionInfo> = {}): SessionInfo {
  return {
    sessionKey: "alpha:s1",
    agentId: "alpha",
    startTime: "2026-04-20T11:00:00.000Z",
    endTime: "2026-04-20T11:30:00.000Z",
    duration: 30 * 60 * 1000,
    toolCallCount: 12,
    avgRisk: 28,
    peakRisk: 55,
    activityBreakdown: {
      exploring: 5,
      changes: 3,
      git: 1,
      scripts: 2,
      web: 1,
      comms: 0,
      orchestration: 0,
      media: 0,
    },
    blockedCount: 0,
    toolSummary: [],
    riskSparkline: [],
    ...partial,
  };
}

function renderHeader() {
  return render(
    <MemoryRouter>
      <SessionHeader session={makeSession()} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useSessionSummaryMock.mockReturnValue({
    summary: null,
    summaryKind: undefined,
    isLlmGenerated: false,
    loading: false,
    generate: vi.fn(),
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("SessionHeader — summaryKind contract (issue #76)", () => {
  // The session-detail page's summarize affordance reads from the same
  // /api/session/:key/summary endpoint as the card popover. Both render
  // the same degraded sentence when summaryKind === "degraded_no_key".
  const DEGRADED_TEXT =
    "LLM evaluation is enabled, but OpenClaw could not resolve a provider key. ClawLens is using deterministic scoring only.";

  it("renders the [data-cl-session-summary-degraded] block when summaryKind='degraded_no_key'", () => {
    useSessionSummaryMock.mockReturnValue({
      summary: DEGRADED_TEXT,
      summaryKind: "degraded_no_key",
      isLlmGenerated: false,
      loading: false,
      generate: vi.fn(),
    });
    const { container } = renderHeader();
    const block = container.querySelector<HTMLElement>("[data-cl-session-summary-degraded]");
    expect(block).not.toBeNull();
    expect(block!.textContent ?? "").toContain("OpenClaw could not resolve a provider key");
  });

  it("does NOT render the 'AI' badge in degraded_no_key state (it's not LLM-generated)", () => {
    useSessionSummaryMock.mockReturnValue({
      summary: DEGRADED_TEXT,
      summaryKind: "degraded_no_key",
      isLlmGenerated: false,
      loading: false,
      generate: vi.fn(),
    });
    const { container } = renderHeader();
    // Badge is the small "AI" label-mono pill — it sits next to LLM-generated
    // summaries to call out provenance. Degraded text wasn't generated.
    const spans = Array.from(container.querySelectorAll<HTMLElement>("span"));
    const aiBadge = spans.find((s) => (s.textContent ?? "").trim() === "AI");
    expect(aiBadge).toBeUndefined();
  });

  it("renders the 'AI' badge for summaryKind='llm' with isLlmGenerated=true", () => {
    useSessionSummaryMock.mockReturnValue({
      summary: "Agent runs scheduled health checks across the search pipelines.",
      summaryKind: "llm",
      isLlmGenerated: true,
      loading: false,
      generate: vi.fn(),
    });
    const { container } = renderHeader();
    const spans = Array.from(container.querySelectorAll<HTMLElement>("span"));
    const aiBadge = spans.find((s) => (s.textContent ?? "").trim() === "AI");
    expect(aiBadge).not.toBeUndefined();
  });

  it("does NOT render the [data-cl-session-summary-degraded] block for non-degraded kinds", () => {
    useSessionSummaryMock.mockReturnValue({
      summary: "Ran 5 actions. Avg risk: 20.",
      summaryKind: "template",
      isLlmGenerated: false,
      loading: false,
      generate: vi.fn(),
    });
    const { container } = renderHeader();
    expect(container.querySelector("[data-cl-session-summary-degraded]")).toBeNull();
  });

  it("uses --cl-risk-medium (warn) color for the degraded body", () => {
    useSessionSummaryMock.mockReturnValue({
      summary: DEGRADED_TEXT,
      summaryKind: "degraded_no_key",
      isLlmGenerated: false,
      loading: false,
      generate: vi.fn(),
    });
    const { container } = renderHeader();
    const block = container.querySelector<HTMLElement>("[data-cl-session-summary-degraded]");
    expect(block).not.toBeNull();
    expect(block!.style.color).toContain("var(--cl-risk-medium)");
  });

  it("renders the 'Summarize session' trigger button when there is no summary yet", () => {
    useSessionSummaryMock.mockReturnValue({
      summary: null,
      summaryKind: undefined,
      isLlmGenerated: false,
      loading: false,
      generate: vi.fn(),
    });
    const { container } = renderHeader();
    const button = Array.from(container.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Summarize session"),
    );
    expect(button).not.toBeUndefined();
  });
});
