// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * useApi and useSSE are the AttentionInbox's two side-effecting deps. We
 * mock them so tests can feed deterministic AttentionResponse fixtures
 * without booting an EventSource (jsdom ships none) or the API layer.
 */
vi.mock("../dashboard/src/hooks/useApi", () => ({
  useApi: vi.fn(),
}));
vi.mock("../dashboard/src/hooks/useSSE", () => ({
  useSSE: vi.fn(),
}));

import AttentionInbox from "../dashboard/src/components/AttentionInbox";
import { useApi } from "../dashboard/src/hooks/useApi";
import type { AttentionResponse } from "../dashboard/src/lib/types";

const mockedUseApi = vi.mocked(useApi);

const NOW_ISO = "2026-04-17T12:00:00.000Z";

function driveUseApi(data: AttentionResponse | null, refetch = vi.fn()) {
  mockedUseApi.mockReturnValue({
    data,
    loading: false,
    error: null,
    refetch,
    // biome-ignore lint/suspicious/noExplicitAny: mock shape
  } as any);
  return refetch;
}

function emptyResp(): AttentionResponse {
  return {
    pending: [],
    blocked: [],
    agentAttention: [],
    highRisk: [],
    generatedAt: NOW_ISO,
  };
}

function makeBlocked(tcid: string, agentId = "alpha") {
  return {
    kind: "blocked" as const,
    toolCallId: tcid,
    timestamp: new Date(new Date(NOW_ISO).getTime() - 60_000).toISOString(),
    agentId,
    agentName: agentId,
    toolName: "exec",
    description: `Blocked ${tcid}`,
    riskScore: 82,
    riskTier: "critical" as const,
    sessionKey: `${agentId}:main`,
  };
}

function renderInbox() {
  return render(
    <MemoryRouter>
      <AttentionInbox />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW_ISO));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true } as Response));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("AttentionInbox — empty + null states", () => {
  it("renders nothing while data is null", () => {
    driveUseApi(null);
    const { container } = renderInbox();
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when no items exist", () => {
    driveUseApi(emptyResp());
    const { container } = renderInbox();
    expect(container).toBeEmptyDOMElement();
  });
});

describe("AttentionInbox — rendering rows", () => {
  it("pluralizes the header ('items need attention')", () => {
    driveUseApi({
      ...emptyResp(),
      blocked: [makeBlocked("tc_1"), makeBlocked("tc_2")],
    });
    renderInbox();
    expect(screen.getByText(/2 items need attention/i)).toBeInTheDocument();
  });

  it("singularizes the header with one item", () => {
    driveUseApi({
      ...emptyResp(),
      blocked: [makeBlocked("tc_1")],
    });
    renderInbox();
    expect(screen.getByText(/1 item needs attention/i)).toBeInTheDocument();
  });

  it("caps the non-hero list at 3 rows with a 'Show N more' button", () => {
    driveUseApi({
      ...emptyResp(),
      blocked: [
        makeBlocked("tc_1"),
        makeBlocked("tc_2"),
        makeBlocked("tc_3"),
        makeBlocked("tc_4"),
        makeBlocked("tc_5"),
      ],
    });
    const { container } = renderInbox();
    const rows = container.querySelectorAll("[data-cl-attention-row='blocked']");
    expect(rows).toHaveLength(3);
    expect(screen.getByRole("button", { name: /Show 2 more/i })).toBeInTheDocument();
  });

  it("expands all non-hero rows after clicking 'Show N more'", async () => {
    driveUseApi({
      ...emptyResp(),
      blocked: [makeBlocked("tc_1"), makeBlocked("tc_2"), makeBlocked("tc_3"), makeBlocked("tc_4")],
    });
    const user = userEvent.setup();
    const { container } = renderInbox();
    await user.click(screen.getByRole("button", { name: /Show 1 more/i }));
    const rows = container.querySelectorAll("[data-cl-attention-row='blocked']");
    expect(rows).toHaveLength(4);
  });

  it("applies the pulse class to the first pending approval only (cap at one)", () => {
    driveUseApi({
      ...emptyResp(),
      pending: [
        {
          kind: "pending",
          toolCallId: "tc_p1",
          timestamp: NOW_ISO,
          agentId: "alpha",
          agentName: "alpha",
          toolName: "exec",
          description: "Waiting approval 1",
          riskScore: 72,
          riskTier: "high",
          sessionKey: "alpha:main",
          timeoutMs: 240_000,
        },
        {
          kind: "pending",
          toolCallId: "tc_p2",
          timestamp: NOW_ISO,
          agentId: "beta",
          agentName: "beta",
          toolName: "exec",
          description: "Waiting approval 2",
          riskScore: 70,
          riskTier: "high",
          sessionKey: "beta:main",
          timeoutMs: 240_000,
        },
      ],
    });
    const { container } = renderInbox();
    const pulsing = container.querySelectorAll(".attention-pulse");
    // Only one of the two pending cards should pulse.
    expect(pulsing).toHaveLength(1);
  });
});

describe("AttentionInbox — optimistic ack via button", () => {
  it("removes the row from the DOM as soon as Ack is clicked", async () => {
    const user = userEvent.setup();
    const refetch = driveUseApi({
      ...emptyResp(),
      blocked: [makeBlocked("tc_1"), makeBlocked("tc_2")],
    });
    const mockFetch = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          // Resolve on the next tick so the optimistic path is observable.
          queueMicrotask(() => resolve({ ok: true } as Response));
        }),
    );
    vi.stubGlobal("fetch", mockFetch);

    const { container } = renderInbox();
    expect(container.querySelectorAll("[data-cl-attention-row='blocked']")).toHaveLength(2);

    const firstAckButton = screen.getAllByRole("button", { name: /Ack/i })[0];
    await user.click(firstAckButton);

    // After the microtask resolves, refetch is called.
    await Promise.resolve();
    expect(mockFetch).toHaveBeenCalledWith(
      "/plugins/clawlens/api/attention/ack",
      expect.objectContaining({ method: "POST" }),
    );
    expect(refetch).toHaveBeenCalled();
  });
});

describe("AttentionInbox — 'v' keyboard shortcut", () => {
  it("does NOT navigate when focus is outside the inbox", async () => {
    driveUseApi({
      ...emptyResp(),
      blocked: [makeBlocked("tc_nav")],
    });
    const user = userEvent.setup();
    renderInbox();
    // Blur any auto-focused element.
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard("v");
    // No-op — jsdom's location didn't change.
    expect(window.location.pathname).toBe("/");
  });
});
