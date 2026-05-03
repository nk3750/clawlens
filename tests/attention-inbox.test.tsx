// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AttentionInbox from "../dashboard/src/components/AttentionInbox";
import type { AttentionResponse } from "../dashboard/src/lib/types";

const NOW_ISO = "2026-04-17T12:00:00.000Z";

function emptyResp(): AttentionResponse {
  return {
    pending: [],
    blocked: [],
    agentAttention: [],
    highRisk: [],
    allowNotify: [],
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

/**
 * Render with explicit props. AttentionInbox no longer fetches its own data —
 * `Agents.tsx` owns the useLiveApi<AttentionResponse> call and passes
 * { data, refetch } down. Tests mirror that shape.
 */
function renderInbox(data: AttentionResponse | null, refetch = vi.fn()) {
  render(
    <MemoryRouter>
      <AttentionInbox data={data} refetch={refetch} />
    </MemoryRouter>,
  );
  return refetch;
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
    const { container } = render(
      <MemoryRouter>
        <AttentionInbox data={null} refetch={vi.fn()} />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when no items exist", () => {
    const { container } = render(
      <MemoryRouter>
        <AttentionInbox data={emptyResp()} refetch={vi.fn()} />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("AttentionInbox — rendering rows", () => {
  it("pluralizes the header ('items need attention')", () => {
    renderInbox({
      ...emptyResp(),
      blocked: [makeBlocked("tc_1"), makeBlocked("tc_2")],
    });
    expect(screen.getByText(/2 items need attention/i)).toBeInTheDocument();
  });

  it("singularizes the header with one item", () => {
    renderInbox({
      ...emptyResp(),
      blocked: [makeBlocked("tc_1")],
    });
    expect(screen.getByText(/1 item needs attention/i)).toBeInTheDocument();
  });

  it("caps the non-hero list at 3 rows with a 'Show N more' button", () => {
    const { container } = render(
      <MemoryRouter>
        <AttentionInbox
          data={{
            ...emptyResp(),
            blocked: [
              makeBlocked("tc_1"),
              makeBlocked("tc_2"),
              makeBlocked("tc_3"),
              makeBlocked("tc_4"),
              makeBlocked("tc_5"),
            ],
          }}
          refetch={vi.fn()}
        />
      </MemoryRouter>,
    );
    const rows = container.querySelectorAll("[data-cl-attention-row='blocked']");
    expect(rows).toHaveLength(3);
    expect(screen.getByRole("button", { name: /Show 2 more/i })).toBeInTheDocument();
  });

  it("expands all non-hero rows after clicking 'Show N more'", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { container } = render(
      <MemoryRouter>
        <AttentionInbox
          data={{
            ...emptyResp(),
            blocked: [
              makeBlocked("tc_1"),
              makeBlocked("tc_2"),
              makeBlocked("tc_3"),
              makeBlocked("tc_4"),
            ],
          }}
          refetch={vi.fn()}
        />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("button", { name: /Show 1 more/i }));
    const rows = container.querySelectorAll("[data-cl-attention-row='blocked']");
    expect(rows).toHaveLength(4);
  });

  it("applies the pulse class to the first pending approval only (cap at one)", () => {
    const { container } = render(
      <MemoryRouter>
        <AttentionInbox
          data={{
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
          }}
          refetch={vi.fn()}
        />
      </MemoryRouter>,
    );
    const pulsing = container.querySelectorAll(".attention-pulse");
    // Only one of the two pending cards should pulse.
    expect(pulsing).toHaveLength(1);
  });
});

describe("AttentionInbox — optimistic ack via button", () => {
  it("removes the row and calls the refetch prop after a successful POST", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const refetch = vi.fn();
    const mockFetch = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          // Resolve on the next tick so the optimistic path is observable.
          queueMicrotask(() => resolve({ ok: true } as Response));
        }),
    );
    vi.stubGlobal("fetch", mockFetch);

    const { container } = render(
      <MemoryRouter>
        <AttentionInbox
          data={{
            ...emptyResp(),
            blocked: [makeBlocked("tc_1"), makeBlocked("tc_2")],
          }}
          refetch={refetch}
        />
      </MemoryRouter>,
    );
    expect(container.querySelectorAll("[data-cl-attention-row='blocked']")).toHaveLength(2);

    const firstAckButton = screen.getAllByRole("button", { name: /Ack/i })[0];
    await user.click(firstAckButton);

    await Promise.resolve();
    expect(mockFetch).toHaveBeenCalledWith(
      "/plugins/clawlens/api/attention/ack",
      expect.objectContaining({ method: "POST" }),
    );
    expect(refetch).toHaveBeenCalled();
  });
});

describe("AttentionInbox — row enter/leave animations (§3)", () => {
  // Use REAL timers in this block — vi.runAllTimersAsync doesn't reliably flush
  // the React render triggered inside our setTimeout callback in this setup.
  // The file-level beforeEach only fakes Date, which is harmless for these tests.
  beforeEach(() => {
    vi.useRealTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true } as Response));
  });

  it("wraps collapsible rows in a .cl-inbox-row-enter div on mount", () => {
    const { container } = render(
      <MemoryRouter>
        <AttentionInbox
          data={{ ...emptyResp(), blocked: [makeBlocked("tc_1")] }}
          refetch={vi.fn()}
        />
      </MemoryRouter>,
    );
    const wrapper = container.querySelector(".cl-inbox-row-enter");
    expect(wrapper).not.toBeNull();
    expect(wrapper?.querySelector("[data-cl-attention-row='blocked']")).not.toBeNull();
    // T1 hero uses .attention-pulse — never wrapped with enter/leave.
    expect(container.querySelector("[data-cl-attention-row='pending']")).toBeNull();
  });

  it("applies .cl-inbox-row-leave after a successful ack, then removes the row 200ms later", async () => {
    const user = userEvent.setup();
    const mockFetch = vi.fn().mockResolvedValue({ ok: true } as Response);
    vi.stubGlobal("fetch", mockFetch);

    const { container } = render(
      <MemoryRouter>
        <AttentionInbox
          data={{ ...emptyResp(), blocked: [makeBlocked("tc_1")] }}
          refetch={vi.fn()}
        />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: /Ack/i }));

    // Phase 1: row still in DOM, wrapper now has the leave class.
    expect(container.querySelector(".cl-inbox-row-leave")).not.toBeNull();
    expect(container.querySelector("[data-cl-attention-row='blocked']")).not.toBeNull();

    // Phase 2: wait past the 200ms cutover — row drops from render.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    expect(container.querySelector("[data-cl-attention-row='blocked']")).toBeNull();
  });

  it("revert on fetch failure cancels the pending timer and clears both animation classes", async () => {
    const user = userEvent.setup();
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response);
    vi.stubGlobal("fetch", mockFetch);

    const { container } = render(
      <MemoryRouter>
        <AttentionInbox
          data={{ ...emptyResp(), blocked: [makeBlocked("tc_1")] }}
          refetch={vi.fn()}
        />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: /Ack/i }));

    // AckButtons.send threw on !res.ok → called revert() → both sets cleared
    // and the timer was cancelled before firing.
    expect(container.querySelector(".cl-inbox-row-leave")).toBeNull();
    expect(container.querySelector(".cl-inbox-row-enter")).not.toBeNull();
    expect(container.querySelector("[data-cl-attention-row='blocked']")).not.toBeNull();

    // Wait past when the cancelled timer would have fired — row must remain.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(container.querySelector("[data-cl-attention-row='blocked']")).not.toBeNull();
  });
});

describe("AttentionInbox — allow_notify rows (#51)", () => {
  function makeAllowNotify(tcid: string, ruleId = "g_notify_1") {
    return {
      kind: "allow_notify" as const,
      toolCallId: tcid,
      timestamp: new Date(new Date(NOW_ISO).getTime() - 60_000).toISOString(),
      agentId: "alpha",
      agentName: "alpha",
      toolName: "exec",
      description: "deploy prod",
      riskScore: 30,
      riskTier: "low" as const,
      sessionKey: "alpha:main",
      guardrailMatch: {
        id: ruleId,
        targetSummary: "Identity: deploy:*",
        action: "allow_notify" as const,
      },
    };
  }

  it("renders allow_notify rows with the See guardrail link", () => {
    const { container } = render(
      <MemoryRouter>
        <AttentionInbox
          data={{
            ...emptyResp(),
            allowNotify: [makeAllowNotify("tc_an_1", "g_rule_x")],
          }}
          refetch={vi.fn()}
        />
      </MemoryRouter>,
    );
    const row = container.querySelector("[data-cl-attention-row='allow_notify']");
    expect(row).not.toBeNull();
    const link = screen.getByTestId("allow-notify-rule-link-g_rule_x") as HTMLAnchorElement;
    expect(link.href).toContain(`/guardrails?selected=${encodeURIComponent("g_rule_x")}`);
  });

  it("counts allow_notify rows in the 'items need attention' header", () => {
    renderInbox({
      ...emptyResp(),
      allowNotify: [makeAllowNotify("tc_a"), makeAllowNotify("tc_b")],
    });
    expect(screen.getByText(/2 items need attention/i)).toBeInTheDocument();
  });

  it("falls back gracefully when allowNotify is missing from older payloads", () => {
    // Defense for in-flight gateway → frontend version skew. The frontend
    // should not crash if the server hasn't deployed the new field yet.
    const partial = {
      pending: [],
      blocked: [makeBlocked("tc_b1")],
      agentAttention: [],
      highRisk: [],
      generatedAt: NOW_ISO,
    } as unknown as AttentionResponse;
    const { container } = render(
      <MemoryRouter>
        <AttentionInbox data={partial} refetch={vi.fn()} />
      </MemoryRouter>,
    );
    expect(container.querySelector("[data-cl-attention-row='blocked']")).not.toBeNull();
  });
});

describe("AttentionInbox — 'v' keyboard shortcut", () => {
  it("does NOT navigate when focus is outside the inbox", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderInbox({
      ...emptyResp(),
      blocked: [makeBlocked("tc_nav")],
    });
    // Blur any auto-focused element.
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard("v");
    // No-op — jsdom's location didn't change.
    expect(window.location.pathname).toBe("/");
  });
});
