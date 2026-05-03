// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import BulkAckChips, {
  BULK_ACK_THRESHOLD,
} from "../dashboard/src/components/attention/BulkAckChips";
import type { AttentionAgent, AttentionItem, AttentionResponse } from "../dashboard/src/lib/types";

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

function blocked(tcid: string, agentId: string): AttentionItem {
  return {
    kind: "blocked",
    toolCallId: tcid,
    timestamp: new Date(new Date(NOW_ISO).getTime() - 60_000).toISOString(),
    agentId,
    agentName: agentId,
    toolName: "exec",
    description: `Blocked ${tcid}`,
    riskScore: 80,
    riskTier: "critical",
    sessionKey: `${agentId}:main`,
  };
}

function highRisk(tcid: string, agentId: string): AttentionItem {
  return {
    kind: "high_risk",
    toolCallId: tcid,
    timestamp: new Date(new Date(NOW_ISO).getTime() - 60_000).toISOString(),
    agentId,
    agentName: agentId,
    toolName: "exec",
    description: `Risky ${tcid}`,
    riskScore: 71,
    riskTier: "high",
    sessionKey: `${agentId}:main`,
    guardrailHint: "no matching guardrail",
    identityKey: `cmd:${tcid}`,
  };
}

function pending(tcid: string, agentId: string): AttentionItem {
  return {
    kind: "pending",
    toolCallId: tcid,
    timestamp: NOW_ISO,
    agentId,
    agentName: agentId,
    toolName: "exec",
    description: `Pending ${tcid}`,
    riskScore: 70,
    riskTier: "high",
    sessionKey: `${agentId}:main`,
    timeoutMs: 240_000,
  };
}

function allowNotify(tcid: string, agentId: string): AttentionItem {
  return {
    kind: "allow_notify",
    toolCallId: tcid,
    timestamp: new Date(new Date(NOW_ISO).getTime() - 60_000).toISOString(),
    agentId,
    agentName: agentId,
    toolName: "exec",
    description: `Notify ${tcid}`,
    riskScore: 30,
    riskTier: "low",
    sessionKey: `${agentId}:main`,
    guardrailMatch: { id: "g_n", targetSummary: "Identity: deploy:*", action: "allow_notify" },
  };
}

function agentAttention(agentId: string): AttentionAgent {
  return {
    agentId,
    agentName: agentId,
    triggerAt: NOW_ISO,
    reason: "block_cluster",
    description: "clustered",
    triggerCount: 5,
    peakTier: "high",
  };
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

describe("BulkAckChips — visibility & threshold", () => {
  it("exports BULK_ACK_THRESHOLD as 2 (the documented default)", () => {
    expect(BULK_ACK_THRESHOLD).toBe(2);
  });

  it("renders nothing when no agent has count >= BULK_ACK_THRESHOLD", () => {
    const { container } = render(
      <BulkAckChips
        data={{
          ...emptyResp(),
          blocked: [blocked("b1", "alpha")],
          highRisk: [highRisk("h1", "beta")],
        }}
        optimisticRemoved={new Set()}
        onOptimisticRemove={() => () => {}}
        onPersisted={vi.fn()}
      />,
    );
    expect(container.querySelector("[data-cl-bulk-ack-chips]")).toBeNull();
  });

  it("renders one chip per agent that meets the threshold across buckets", () => {
    render(
      <BulkAckChips
        data={{
          ...emptyResp(),
          pending: [pending("p1", "alpha")],
          highRisk: [highRisk("h1", "alpha")],
        }}
        optimisticRemoved={new Set()}
        onOptimisticRemove={() => () => {}}
        onPersisted={vi.fn()}
      />,
    );
    const chips = screen.getAllByRole("button");
    expect(chips).toHaveLength(1);
    expect(chips[0]?.textContent).toMatch(/Ack all from alpha · 2/);
  });

  it("excludes agentAttention items from the count (they are no longer rows)", () => {
    const { container } = render(
      <BulkAckChips
        data={{
          ...emptyResp(),
          agentAttention: [agentAttention("alpha"), agentAttention("alpha")],
          highRisk: [highRisk("h1", "alpha")],
        }}
        optimisticRemoved={new Set()}
        onOptimisticRemove={() => () => {}}
        onPersisted={vi.fn()}
      />,
    );
    expect(container.querySelector("[data-cl-bulk-ack-chips]")).toBeNull();
  });

  it("excludes optimistically-removed items from the count", () => {
    // pending uses the "blocked:" key prefix to match AttentionInbox's removal scheme.
    const removed = new Set<string>(["blocked:p1"]);
    const { container } = render(
      <BulkAckChips
        data={{
          ...emptyResp(),
          pending: [pending("p1", "alpha")],
          highRisk: [highRisk("h1", "alpha")],
        }}
        optimisticRemoved={removed}
        onOptimisticRemove={() => () => {}}
        onPersisted={vi.fn()}
      />,
    );
    expect(container.querySelector("[data-cl-bulk-ack-chips]")).toBeNull();
  });
});

describe("BulkAckChips — sort order", () => {
  it("sorts chips by count desc, then by agentId asc for ties", () => {
    render(
      <BulkAckChips
        data={{
          ...emptyResp(),
          blocked: [blocked("b1", "zzz"), blocked("b2", "alpha"), blocked("b3", "beta")],
          highRisk: [
            highRisk("h1", "zzz"),
            highRisk("h2", "alpha"),
            highRisk("h3", "alpha"),
            highRisk("h4", "beta"),
          ],
        }}
        optimisticRemoved={new Set()}
        onOptimisticRemove={() => () => {}}
        onPersisted={vi.fn()}
      />,
    );
    // Counts: alpha=3, beta=2, zzz=2 → expected order alpha, beta, zzz.
    const chips = screen.getAllByRole("button").map((b) => b.textContent ?? "");
    expect(chips).toHaveLength(3);
    expect(chips[0]).toMatch(/alpha · 3/);
    expect(chips[1]).toMatch(/beta · 2/);
    expect(chips[2]).toMatch(/zzz · 2/);
  });
});

describe("BulkAckChips — click behavior", () => {
  it("POSTs the agent-scope ack with a fresh ISO upToIso and removes every visible item for that agent", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const removeCalls: string[] = [];
    const onOptimisticRemove = vi.fn((key: string) => {
      removeCalls.push(key);
      return () => {};
    });
    const onPersisted = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    vi.stubGlobal("fetch", fetchMock);

    render(
      <BulkAckChips
        data={{
          ...emptyResp(),
          pending: [pending("p1", "alpha")],
          blocked: [blocked("b1", "alpha")],
          highRisk: [highRisk("h1", "alpha")],
          allowNotify: [allowNotify("an1", "alpha")],
        }}
        optimisticRemoved={new Set()}
        onOptimisticRemove={onOptimisticRemove}
        onPersisted={onPersisted}
      />,
    );

    await user.click(screen.getByRole("button"));

    // Optimistic removal happens synchronously, before the fetch resolves.
    // pending uses "blocked:" prefix to match AttentionInbox's existing scheme.
    expect(removeCalls.sort()).toEqual(
      ["allow_notify:an1", "blocked:b1", "blocked:p1", "highrisk:h1"].sort(),
    );

    await waitFor(() => expect(onPersisted).toHaveBeenCalledTimes(1));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/plugins/clawlens/api/attention/ack");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string) as {
      scope: { kind: string; agentId: string; upToIso: string };
    };
    expect(body.scope.kind).toBe("agent");
    expect(body.scope.agentId).toBe("alpha");
    // upToIso must be a parseable ISO string.
    expect(Number.isFinite(Date.parse(body.scope.upToIso))).toBe(true);
  });

  it("reverts every optimistic removal in lockstep when the POST fails", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const reverts: ReturnType<typeof vi.fn>[] = [];
    const onOptimisticRemove = vi.fn(() => {
      const r = vi.fn();
      reverts.push(r);
      return r;
    });
    const onPersisted = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response));

    render(
      <BulkAckChips
        data={{
          ...emptyResp(),
          blocked: [blocked("b1", "alpha")],
          highRisk: [highRisk("h1", "alpha")],
        }}
        optimisticRemoved={new Set()}
        onOptimisticRemove={onOptimisticRemove}
        onPersisted={onPersisted}
      />,
    );

    await user.click(screen.getByRole("button"));
    await waitFor(() => expect(reverts.length).toBe(2));
    await waitFor(() => {
      for (const r of reverts) expect(r).toHaveBeenCalledTimes(1);
    });
    expect(onPersisted).not.toHaveBeenCalled();
  });
});

describe("BulkAckChips — accessibility", () => {
  it("wraps chips in a role='group' with aria-label='Bulk acknowledge'", () => {
    render(
      <BulkAckChips
        data={{
          ...emptyResp(),
          blocked: [blocked("b1", "alpha")],
          highRisk: [highRisk("h1", "alpha")],
        }}
        optimisticRemoved={new Set()}
        onOptimisticRemove={() => () => {}}
        onPersisted={vi.fn()}
      />,
    );
    const group = screen.getByRole("group", { name: /Bulk acknowledge/i });
    expect(group).toBeInTheDocument();
  });

  it("sets a descriptive aria-label per chip", () => {
    render(
      <BulkAckChips
        data={{
          ...emptyResp(),
          blocked: [blocked("b1", "alpha"), blocked("b2", "alpha")],
          highRisk: [highRisk("h1", "alpha")],
        }}
        optimisticRemoved={new Set()}
        onOptimisticRemove={() => () => {}}
        onPersisted={vi.fn()}
      />,
    );
    const chip = screen.getByRole("button", {
      name: /Acknowledge all 3 attention items from alpha/i,
    });
    expect(chip).toBeInTheDocument();
  });
});
