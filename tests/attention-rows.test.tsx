// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AckButtons from "../dashboard/src/components/attention/AckButtons";
import AgentAttentionRow from "../dashboard/src/components/attention/AgentAttentionRow";
import ApprovalCard from "../dashboard/src/components/attention/ApprovalCard";
import BlockedRow from "../dashboard/src/components/attention/BlockedRow";
import HighRiskRow from "../dashboard/src/components/attention/HighRiskRow";
import type { AttentionAgent, AttentionItem } from "../dashboard/src/lib/types";

const NOW_ISO = "2026-04-17T12:00:00.000Z";

function blockedItem(overrides: Partial<AttentionItem> = {}): AttentionItem {
  return {
    kind: "blocked",
    toolCallId: "tc_abc",
    timestamp: new Date(Date.now() - 60_000).toISOString(),
    agentId: "alpha",
    agentName: "alpha",
    toolName: "exec",
    description: "Ran rm -rf /tmp/scratch",
    riskScore: 82,
    riskTier: "critical",
    sessionKey: "alpha:main",
    ...overrides,
  };
}

function agentItem(overrides: Partial<AttentionAgent> = {}): AttentionAgent {
  return {
    agentId: "seo",
    agentName: "seo-growth",
    triggerAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    reason: "block_cluster",
    description: "3 blocked actions in the last 10 min",
    triggerCount: 3,
    peakTier: "medium",
    lastSessionKey: "seo:cron:trend-007",
    ...overrides,
  };
}

function wrap(node: React.ReactNode) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW_ISO));
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("BlockedRow", () => {
  it("renders agent name, description, view link, and a single Ack button (no Dismiss)", () => {
    wrap(
      <BlockedRow
        item={blockedItem()}
        isLast
        onOptimisticRemove={() => () => {}}
        onPersisted={vi.fn()}
      />,
    );
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText(/Ran rm -rf/)).toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: /View session/i });
    expect(links.length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Ack/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Dismiss/i })).toBeNull();
  });

  it("distinguishes kind=timeout from kind=blocked via the 'Timed out' verb", () => {
    wrap(
      <BlockedRow
        item={blockedItem({ kind: "timeout" })}
        isLast
        onOptimisticRemove={() => () => {}}
        onPersisted={vi.fn()}
      />,
    );
    expect(screen.getByText(/Timed out/i)).toBeInTheDocument();
  });
});

describe("AgentAttentionRow", () => {
  it("uses agentName, not agentId, for the primary label", () => {
    wrap(
      <AgentAttentionRow
        item={agentItem({ agentId: "seo", agentName: "Seo Growth" })}
        isLast
        onOptimisticRemove={() => () => {}}
        onPersisted={vi.fn()}
      />,
    );
    expect(screen.getByText("Seo Growth")).toBeInTheDocument();
  });

  it("links the View button to /agent/:id", () => {
    wrap(
      <AgentAttentionRow
        item={agentItem({ agentId: "seo" })}
        isLast
        onOptimisticRemove={() => () => {}}
        onPersisted={vi.fn()}
      />,
    );
    const link = screen.getByRole("link", { name: /View agent/i });
    expect(link).toHaveAttribute("href", "/agent/seo");
  });

  it("renders the rule-specific description (not the old hardcoded 'needs attention')", () => {
    wrap(
      <AgentAttentionRow
        item={agentItem({ description: "Session average risk: 64" })}
        isLast
        onOptimisticRemove={() => () => {}}
        onPersisted={vi.fn()}
      />,
    );
    expect(screen.getByText(/Session average risk: 64/)).toBeInTheDocument();
    expect(screen.queryByText(/needs attention/i)).toBeNull();
  });
});

describe("HighRiskRow", () => {
  it("prepends 'Unguarded:' label only when guardrailHint is set", () => {
    const { rerender } = wrap(
      <HighRiskRow
        item={blockedItem({ kind: "high_risk", guardrailHint: "no matching guardrail" })}
        isLast
        onOptimisticRemove={() => () => {}}
        onPersisted={vi.fn()}
      />,
    );
    expect(screen.getByText(/Unguarded/)).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <HighRiskRow
          item={blockedItem({ kind: "high_risk", guardrailHint: undefined })}
          isLast
          onOptimisticRemove={() => () => {}}
          onPersisted={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByText(/Unguarded/)).toBeNull();
  });
});

describe("ApprovalCard", () => {
  it("renders the hero layout with agent name, countdown, and Review link", () => {
    wrap(
      <ApprovalCard
        item={blockedItem({
          kind: "pending",
          timeoutMs: 240_000,
          sessionKey: "alpha:main",
        })}
        pulsing
      />,
    );
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText(/is waiting for approval/)).toBeInTheDocument();
    expect(screen.getByText("4:00")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Review/ });
    expect(link).toHaveAttribute("href", "/session/alpha%3Amain");
  });

  it("shows 'Timed out' when timeoutMs is 0", () => {
    wrap(<ApprovalCard item={blockedItem({ kind: "pending", timeoutMs: 0 })} pulsing={false} />);
    expect(screen.getByText(/Timed out/)).toBeInTheDocument();
  });

  it("applies the pulse class only when pulsing=true", () => {
    const { container, rerender } = wrap(
      <ApprovalCard item={blockedItem({ kind: "pending", timeoutMs: 240_000 })} pulsing />,
    );
    expect(container.querySelector(".attention-pulse")).not.toBeNull();

    rerender(
      <MemoryRouter>
        <ApprovalCard item={blockedItem({ kind: "pending", timeoutMs: 240_000 })} pulsing={false} />
      </MemoryRouter>,
    );
    expect(container.querySelector(".attention-pulse")).toBeNull();
  });
});

describe("AckButtons — optimistic flow", () => {
  it("calls onOptimisticRemove immediately, POSTs, and fires onPersisted on success", async () => {
    const user = userEvent.setup();
    const revert = vi.fn();
    const onOpt = vi.fn(() => revert);
    const onPers = vi.fn();
    const mockFetch = vi.fn().mockResolvedValue({ ok: true } as Response);
    vi.stubGlobal("fetch", mockFetch);

    wrap(
      <AckButtons
        scope={{ kind: "entry", toolCallId: "tc_42" }}
        onOptimisticRemove={onOpt}
        onPersisted={onPers}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Ack/i }));
    expect(onOpt).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      "/plugins/clawlens/api/attention/ack",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("tc_42"),
      }),
    );
    expect(onPers).toHaveBeenCalledTimes(1);
    expect(revert).not.toHaveBeenCalled();
  });

  it("calls revert() on POST failure (preserves the row)", async () => {
    const user = userEvent.setup();
    const revert = vi.fn();
    const onOpt = vi.fn(() => revert);
    const onPers = vi.fn();
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response);
    vi.stubGlobal("fetch", mockFetch);

    wrap(
      <AckButtons
        scope={{ kind: "entry", toolCallId: "tc_err" }}
        onOptimisticRemove={onOpt}
        onPersisted={onPers}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Ack/i }));
    expect(onOpt).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      "/plugins/clawlens/api/attention/ack",
      expect.any(Object),
    );
    expect(revert).toHaveBeenCalledTimes(1);
    expect(onPers).not.toHaveBeenCalled();
  });

  it("sends agent-scoped payload when scope.kind='agent'", async () => {
    const user = userEvent.setup();
    const mockFetch = vi.fn().mockResolvedValue({ ok: true } as Response);
    vi.stubGlobal("fetch", mockFetch);

    wrap(
      <AckButtons
        scope={{ kind: "agent", agentId: "seo", upToIso: NOW_ISO }}
        onOptimisticRemove={() => () => {}}
        onPersisted={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Ack/i }));
    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.scope).toEqual({ kind: "agent", agentId: "seo", upToIso: NOW_ISO });
  });
});
