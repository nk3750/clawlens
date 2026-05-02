// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GuardrailModal from "../dashboard/src/components/GuardrailModal";
import type { EntryResponse } from "../dashboard/src/lib/types";

const entry: EntryResponse = {
  timestamp: new Date().toISOString(),
  toolName: "exec",
  toolCallId: "tc_modal",
  params: { command: "ls" },
  effectiveDecision: "allow",
  category: "scripts",
  agentId: "alpha",
  sessionKey: "sk_1",
  riskScore: 50,
  identityKey: "ls",
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GuardrailModal — §13 portal + animation + POST parity", () => {
  it("mounts as a direct child of document.body via createPortal (escapes ancestor stacking)", () => {
    const { container } = render(
      <div data-testid="wrapper">
        <GuardrailModal entry={entry} description="x" onClose={() => {}} onCreated={() => {}} />
      </div>,
    );
    // The portal source (wrapper) does NOT contain the modal.
    expect(container.querySelector('[data-testid="guardrail-modal"]')).toBeNull();
    // The modal is mounted directly under document.body.
    const modal = document.body.querySelector('[data-testid="guardrail-modal"]');
    expect(modal).not.toBeNull();
    expect(modal?.parentElement).toBe(document.body);
  });

  it("backdrop's inline animation references the cl-fade-in keyframe", () => {
    render(
      <GuardrailModal entry={entry} description="x" onClose={() => {}} onCreated={() => {}} />,
    );
    const modal = document.body.querySelector('[data-testid="guardrail-modal"]') as HTMLElement;
    expect(modal.style.animation).toContain("cl-fade-in");
  });

  it("modal panel's inline animation references the cl-modal-in keyframe", () => {
    render(
      <GuardrailModal entry={entry} description="x" onClose={() => {}} onCreated={() => {}} />,
    );
    const panel = document.body.querySelector(
      '[data-testid="guardrail-modal-panel"]',
    ) as HTMLElement;
    expect(panel.style.animation).toContain("cl-modal-in");
  });

  it("POST body shape is unchanged from v1 (selector + target + action + source + riskScore)", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: "gr_1", existing: false }),
    });
    const onCreated = vi.fn();
    render(
      <GuardrailModal entry={entry} description="x" onClose={() => {}} onCreated={onCreated} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add guardrail/i }));
    // Wait for the async submit to resolve.
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/plugins/clawlens/api/guardrails");
    const body = JSON.parse(String(init.body));
    expect(body.selector.tools).toEqual({ mode: "names", values: ["exec"] });
    expect(body.target).toEqual({ kind: "identity-glob", pattern: "ls" });
    expect(body.action).toBe("block");
    expect(body.source).toEqual({
      toolCallId: "tc_modal",
      sessionKey: "sk_1",
      agentId: "alpha",
    });
    expect(body.riskScore).toBe(50);
  });
});
