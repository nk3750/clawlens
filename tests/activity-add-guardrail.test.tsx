// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ActivityRow from "../dashboard/src/components/activity/ActivityRow";
import GuardrailModal from "../dashboard/src/components/GuardrailModal";
import type { ActivityCategory, EntryResponse } from "../dashboard/src/lib/types";

const NOW = new Date("2026-04-26T18:00:00.000Z").getTime();

function entry(overrides: Partial<EntryResponse> = {}): EntryResponse {
  return {
    timestamp: new Date(NOW - 30 * 1000).toISOString(),
    toolName: "exec",
    toolCallId: "tc_curl",
    params: { command: "curl https://evil.com" },
    effectiveDecision: "allow",
    category: "scripts" as ActivityCategory,
    agentId: "alpha",
    sessionKey: "agent:alpha:session:abc#1",
    riskTier: "high",
    riskScore: 70,
    riskTags: ["destructive"],
    ...overrides,
  };
}

function renderRow(props: { entry?: EntryResponse; isExpanded?: boolean } = {}) {
  return render(
    <MemoryRouter initialEntries={["/activity"]}>
      <ActivityRow
        entry={props.entry ?? entry()}
        isNew={false}
        onChip={vi.fn()}
        isExpanded={props.isExpanded ?? false}
        onToggleExpand={vi.fn()}
      />
    </MemoryRouter>,
  );
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ActivityRow — add-guardrail mounting (Phase 2.6)", () => {
  it("clicking the hover quick-action shield mounts the GuardrailModal", () => {
    renderRow();
    fireEvent.mouseEnter(screen.getByTestId("activity-row-root"));
    const qa = screen.getByTestId("activity-row-quick-actions");
    const shield = within(qa).getByTestId("activity-row-quick-add-guardrail");
    expect((shield as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(shield);
    // Modal heading is "ADD GUARDRAIL".
    expect(screen.getByRole("heading", { name: /add guardrail/i })).toBeInTheDocument();
  });

  it("clicking the expanded-panel add-guardrail button mounts the GuardrailModal", () => {
    renderRow({ isExpanded: true });
    const btn = screen.getByTestId("activity-row-expanded-add-guardrail") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(screen.getByRole("heading", { name: /add guardrail/i })).toBeInTheDocument();
  });

  it("opened modal survives when the operator un-hovers the row", () => {
    renderRow();
    const root = screen.getByTestId("activity-row-root");
    fireEvent.mouseEnter(root);
    const qa = screen.getByTestId("activity-row-quick-actions");
    fireEvent.click(within(qa).getByTestId("activity-row-quick-add-guardrail"));
    expect(screen.getByRole("heading", { name: /add guardrail/i })).toBeInTheDocument();
    // Mouse leaves — quick-actions strip unmounts but the modal must persist.
    fireEvent.mouseLeave(root);
    expect(screen.queryByTestId("activity-row-quick-actions")).toBeNull();
    expect(screen.getByRole("heading", { name: /add guardrail/i })).toBeInTheDocument();
  });

  it("clicking the modal Cancel button closes the modal without firing fetch", () => {
    renderRow({ isExpanded: true });
    fireEvent.click(screen.getByTestId("activity-row-expanded-add-guardrail"));
    expect(screen.getByRole("heading", { name: /add guardrail/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.queryByRole("heading", { name: /add guardrail/i })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("submitting the modal POSTs to /plugins/clawlens/api/guardrails with the row's toolCallId, then closes", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          id: "gr_new",
          existing: false,
          tool: "exec",
          identityKey: "curl https://evil.com",
        }),
    });
    renderRow({ isExpanded: true });
    fireEvent.click(screen.getByTestId("activity-row-expanded-add-guardrail"));
    fireEvent.click(
      within(screen.getByTestId("guardrail-modal")).getByRole("button", {
        name: /^add guardrail$/i,
      }),
    );

    await waitFor(() => {
      expect(screen.queryByTestId("guardrail-modal")).toBeNull();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/plugins/clawlens/api/guardrails");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    // Post-rewrite shape: selector + target + action + source. The legacy
    // "block this row" flow constructs the conservative variant — single-tool
    // names selector + identity-glob target pre-filled with the call's key.
    expect(body.action).toBe("block");
    expect(body.selector).toEqual({
      agent: "alpha",
      tools: { mode: "names", values: ["exec"] },
    });
    expect(body.target.kind).toBe("identity-glob");
    expect(body.source.toolCallId).toBe("tc_curl");
  });

  it("submitting twice with idempotent backend (existing:true) still closes the modal — operator can re-open from another row", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ id: "gr_existing", existing: true, tool: "exec", identityKey: "x" }),
    });
    renderRow({ isExpanded: true });
    fireEvent.click(screen.getByTestId("activity-row-expanded-add-guardrail"));
    fireEvent.click(
      within(screen.getByTestId("guardrail-modal")).getByRole("button", {
        name: /^add guardrail$/i,
      }),
    );

    await waitFor(() => {
      expect(screen.queryByTestId("guardrail-modal")).toBeNull();
    });
  });

  it("server error keeps the modal open and shows error text", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: "store write failed" }),
    });
    renderRow({ isExpanded: true });
    fireEvent.click(screen.getByTestId("activity-row-expanded-add-guardrail"));
    fireEvent.click(
      within(screen.getByTestId("guardrail-modal")).getByRole("button", {
        name: /^add guardrail$/i,
      }),
    );

    await waitFor(() => {
      expect(screen.getByText(/store write failed/i)).toBeInTheDocument();
    });
    // Modal still in the DOM.
    expect(screen.getByTestId("guardrail-modal")).toBeInTheDocument();
  });
});

describe("GuardrailModal — onCreated payload (Phase 2.6)", () => {
  function modalEntry(): EntryResponse {
    return entry();
  }

  it("forwards { existing: false } to onCreated for a fresh create", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: "gr_a", existing: false }),
    });
    const onCreated = vi.fn();
    render(
      <GuardrailModal
        entry={modalEntry()}
        description="exec — curl https://evil.com"
        onClose={vi.fn()}
        onCreated={onCreated}
      />,
    );
    fireEvent.click(
      within(screen.getByTestId("guardrail-modal")).getByRole("button", {
        name: /^add guardrail$/i,
      }),
    );
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(onCreated).toHaveBeenCalledWith({ existing: false });
  });

  it("forwards { existing: true } to onCreated when the backend reports a duplicate", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: "gr_a", existing: true }),
    });
    const onCreated = vi.fn();
    render(
      <GuardrailModal
        entry={modalEntry()}
        description="exec — curl https://evil.com"
        onClose={vi.fn()}
        onCreated={onCreated}
      />,
    );
    fireEvent.click(
      within(screen.getByTestId("guardrail-modal")).getByRole("button", {
        name: /^add guardrail$/i,
      }),
    );
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(onCreated).toHaveBeenCalledWith({ existing: true });
  });

  it("defaults to { existing: false } when the backend response omits the flag (older backend)", async () => {
    // Response shape compatibility: a backend without the idempotency
    // patch returns the guardrail with no `existing` field. The frontend
    // must coerce to false rather than throw or send undefined.
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: "gr_a" }),
    });
    const onCreated = vi.fn();
    render(
      <GuardrailModal
        entry={modalEntry()}
        description="exec — curl https://evil.com"
        onClose={vi.fn()}
        onCreated={onCreated}
      />,
    );
    fireEvent.click(
      within(screen.getByTestId("guardrail-modal")).getByRole("button", {
        name: /^add guardrail$/i,
      }),
    );
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(onCreated).toHaveBeenCalledWith({ existing: false });
  });
});
