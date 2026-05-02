// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
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

const fileEntry: EntryResponse = {
  timestamp: new Date().toISOString(),
  toolName: "write",
  toolCallId: "tc_file",
  params: { path: "/Users/op/work/.env" },
  effectiveDecision: "allow",
  category: "changes",
  agentId: "alpha",
  sessionKey: "sk_2",
  riskScore: 70,
  identityKey: "/Users/op/work/.env",
};

const urlEntry: EntryResponse = {
  timestamp: new Date().toISOString(),
  toolName: "web_fetch",
  toolCallId: "tc_url",
  params: { url: "https://api.openai.com/v1/chat/completions" },
  effectiveDecision: "allow",
  category: "web",
  agentId: "alpha",
  sessionKey: "sk_3",
  riskScore: 30,
  identityKey: "https://api.openai.com/v1/chat/completions",
};

const mcpEntry: EntryResponse = {
  timestamp: new Date().toISOString(),
  toolName: "linear_create_ticket",
  toolCallId: "tc_mcp",
  params: { title: "x" },
  effectiveDecision: "allow",
  category: "comms",
  agentId: "alpha",
  sessionKey: "sk_4",
  riskScore: 20,
  identityKey: "linear_create_ticket:title=x",
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

async function submitAndReadBody(): Promise<Record<string, unknown>> {
  fireEvent.click(screen.getByRole("button", { name: /^add guardrail$/i }));
  await Promise.resolve();
  await Promise.resolve();
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
  if (!init) throw new Error("fetch was not called");
  return JSON.parse(String(init.body));
}

function mockOk() {
  fetchMock.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ id: "gr_x", existing: false }),
  });
}

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

// ── Phase 2.5 — verb picker ────────────────────────────

describe("GuardrailModal — verb picker (§5.4.2)", () => {
  it("initial verbs[] === [entry.toolName] and POSTs that single value", async () => {
    mockOk();
    render(
      <GuardrailModal entry={fileEntry} description="x" onClose={() => {}} onCreated={() => {}} />,
    );
    const body = await submitAndReadBody();
    expect((body.selector as { tools: { values: string[] } }).tools.values).toEqual(["write"]);
  });

  it("clicking a different chip appends it to verbs[]", async () => {
    mockOk();
    render(
      <GuardrailModal entry={fileEntry} description="x" onClose={() => {}} onCreated={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^EDIT$/ }));
    const body = await submitAndReadBody();
    expect((body.selector as { tools: { values: string[] } }).tools.values).toEqual([
      "write",
      "edit",
    ]);
  });

  it("clicking a third chip preserves toggle order", async () => {
    mockOk();
    render(
      <GuardrailModal entry={fileEntry} description="x" onClose={() => {}} onCreated={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^EDIT$/ }));
    fireEvent.click(screen.getByRole("button", { name: /^READ$/ }));
    const body = await submitAndReadBody();
    expect((body.selector as { tools: { values: string[] } }).tools.values).toEqual([
      "write",
      "edit",
      "read",
    ]);
  });

  it("clicking the only-selected chip is a no-op (length floor of 1)", async () => {
    mockOk();
    render(
      <GuardrailModal entry={fileEntry} description="x" onClose={() => {}} onCreated={() => {}} />,
    );
    // file entry initial verbs = ["write"]; clicking WRITE should not deselect.
    fireEvent.click(screen.getByRole("button", { name: /^WRITE$/ }));
    const body = await submitAndReadBody();
    expect((body.selector as { tools: { values: string[] } }).tools.values).toEqual(["write"]);
  });

  it("clicking a chip toggles off when verbs has > 1 entries", async () => {
    mockOk();
    render(
      <GuardrailModal entry={fileEntry} description="x" onClose={() => {}} onCreated={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^EDIT$/ })); // [write, edit]
    fireEvent.click(screen.getByRole("button", { name: /^EDIT$/ })); // [write]
    const body = await submitAndReadBody();
    expect((body.selector as { tools: { values: string[] } }).tools.values).toEqual(["write"]);
  });

  it("MCP / unknown tool renders one disabled chip with the literal toolName + advanced badge", () => {
    render(
      <GuardrailModal entry={mcpEntry} description="x" onClose={() => {}} onCreated={() => {}} />,
    );
    const verbs = screen.getByTestId("verb-row");
    // Exactly one chip — the literal tool name (uppercased by VerbChip).
    const chips = within(verbs).getAllByRole("button");
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toContain("LINEAR_CREATE_TICKET");
    expect((chips[0] as HTMLButtonElement).disabled).toBe(true);
    // Advanced mono badge sits next to the chip.
    expect(within(verbs).getByText(/advanced/i)).toBeTruthy();
  });
});

// ── Phase 2.5 — pattern toggle + auto-fill ─────────────

describe("GuardrailModal — pattern mode toggle (§5.4.3)", () => {
  it("default mode is 'exact' and pattern equals entry.identityKey", () => {
    render(
      <GuardrailModal entry={fileEntry} description="x" onClose={() => {}} onCreated={() => {}} />,
    );
    const input = screen.getByTestId("pattern-input") as HTMLInputElement;
    expect(input.value).toBe("/Users/op/work/.env");
    expect(screen.getByTestId("pattern-mode-exact")).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("pattern-mode-glob")).toHaveAttribute("data-active", "false");
  });

  it("flipping to 'glob' auto-fills pattern with suggestGlobs(kind, identityKey)[0]", () => {
    render(
      <GuardrailModal entry={fileEntry} description="x" onClose={() => {}} onCreated={() => {}} />,
    );
    fireEvent.click(screen.getByTestId("pattern-mode-glob"));
    const input = screen.getByTestId("pattern-input") as HTMLInputElement;
    // suggestGlobs("file", "/Users/op/work/.env")[0] === "**/*.env"
    expect(input.value).toBe("**/*.env");
  });

  it("typing into the input locks dirtyPattern and prevents subsequent auto-overwrites", () => {
    render(
      <GuardrailModal entry={fileEntry} description="x" onClose={() => {}} onCreated={() => {}} />,
    );
    const input = screen.getByTestId("pattern-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "/custom/pattern" } });
    expect(input.value).toBe("/custom/pattern");
    fireEvent.click(screen.getByTestId("pattern-mode-glob"));
    expect(input.value).toBe("/custom/pattern"); // not overwritten
    fireEvent.click(screen.getByTestId("pattern-mode-exact"));
    expect(input.value).toBe("/custom/pattern"); // still preserved
  });

  it("flipping back to 'exact' (clean pattern) restores entry.identityKey", () => {
    render(
      <GuardrailModal entry={fileEntry} description="x" onClose={() => {}} onCreated={() => {}} />,
    );
    fireEvent.click(screen.getByTestId("pattern-mode-glob"));
    const input = screen.getByTestId("pattern-input") as HTMLInputElement;
    expect(input.value).toBe("**/*.env");
    fireEvent.click(screen.getByTestId("pattern-mode-exact"));
    expect(input.value).toBe("/Users/op/work/.env");
  });

  it("for an advanced tool, both toggle buttons are disabled and clicking is a no-op", () => {
    render(
      <GuardrailModal entry={mcpEntry} description="x" onClose={() => {}} onCreated={() => {}} />,
    );
    const exactBtn = screen.getByTestId("pattern-mode-exact") as HTMLButtonElement;
    const globBtn = screen.getByTestId("pattern-mode-glob") as HTMLButtonElement;
    expect(exactBtn.disabled).toBe(true);
    expect(globBtn.disabled).toBe(true);
    // Click should not change anything.
    fireEvent.click(globBtn);
    const input = screen.getByTestId("pattern-input") as HTMLInputElement;
    expect(input.value).toBe(mcpEntry.identityKey);
    expect(input.disabled).toBe(true);
  });
});

// ── Phase 2.5 — upgrade banner ─────────────────────────

describe("GuardrailModal — upgrade banner (§5.4.4)", () => {
  it("hidden when single verb + exact mode (no upgrade)", () => {
    render(
      <GuardrailModal entry={fileEntry} description="x" onClose={() => {}} onCreated={() => {}} />,
    );
    expect(screen.queryByTestId("upgrade-banner")).toBeNull();
  });

  it("visible with multi-verb message when verbs.length > 1 in exact mode", () => {
    render(
      <GuardrailModal entry={fileEntry} description="x" onClose={() => {}} onCreated={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^EDIT$/ }));
    const banner = screen.getByTestId("upgrade-banner");
    expect(banner.textContent).toMatch(/multi-verb/i);
    expect(banner.textContent).toContain("identity-glob");
    expect(banner.textContent).toContain("path-glob");
  });

  it("visible with broader-pattern message when patternMode is 'glob' (single verb)", () => {
    render(
      <GuardrailModal entry={urlEntry} description="x" onClose={() => {}} onCreated={() => {}} />,
    );
    fireEvent.click(screen.getByTestId("pattern-mode-glob"));
    const banner = screen.getByTestId("upgrade-banner");
    expect(banner.textContent).toMatch(/broader pattern/i);
    expect(banner.textContent).toContain("identity-glob");
    expect(banner.textContent).toContain("url-glob");
  });

  it("glob-mode reason wins over multi-verb when both are true", () => {
    render(
      <GuardrailModal entry={fileEntry} description="x" onClose={() => {}} onCreated={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^EDIT$/ }));
    fireEvent.click(screen.getByTestId("pattern-mode-glob"));
    const banner = screen.getByTestId("upgrade-banner");
    expect(banner.textContent).toMatch(/broader pattern/i);
    expect(banner.textContent).not.toMatch(/multi-verb/i);
  });

  it("hidden for advanced tool regardless of state", () => {
    render(
      <GuardrailModal entry={mcpEntry} description="x" onClose={() => {}} onCreated={() => {}} />,
    );
    expect(screen.queryByTestId("upgrade-banner")).toBeNull();
  });
});

// ── Phase 2.5 — POST body construction ─────────────────

describe("GuardrailModal — POST body construction (§5.4.6)", () => {
  it("single verb + exact + non-advanced → identity-glob with literal pattern", async () => {
    mockOk();
    render(
      <GuardrailModal entry={fileEntry} description="x" onClose={() => {}} onCreated={() => {}} />,
    );
    const body = await submitAndReadBody();
    expect(body.target).toEqual({ kind: "identity-glob", pattern: "/Users/op/work/.env" });
  });

  it("multi-verb + exact + file → path-glob with literal identity pattern", async () => {
    mockOk();
    render(
      <GuardrailModal entry={fileEntry} description="x" onClose={() => {}} onCreated={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^EDIT$/ }));
    const body = await submitAndReadBody();
    expect(body.target).toEqual({ kind: "path-glob", pattern: "/Users/op/work/.env" });
  });

  it("single verb + glob + url → url-glob with smart-default pattern", async () => {
    mockOk();
    render(
      <GuardrailModal entry={urlEntry} description="x" onClose={() => {}} onCreated={() => {}} />,
    );
    fireEvent.click(screen.getByTestId("pattern-mode-glob"));
    const body = await submitAndReadBody();
    expect(body.target).toEqual({ kind: "url-glob", pattern: "https://api.openai.com/**" });
  });

  it("advanced tool always POSTs identity-glob, even after disabled-toggle clicks", async () => {
    mockOk();
    render(
      <GuardrailModal entry={mcpEntry} description="x" onClose={() => {}} onCreated={() => {}} />,
    );
    fireEvent.click(screen.getByTestId("pattern-mode-glob"));
    const body = await submitAndReadBody();
    expect(body.target).toEqual({ kind: "identity-glob", pattern: mcpEntry.identityKey });
    expect((body.selector as { tools: { values: string[] } }).tools.values).toEqual([
      mcpEntry.toolName,
    ]);
  });

  it("scope='global' sends selector.agent === null; scope='agent' sends entry.agentId", async () => {
    mockOk();
    render(
      <GuardrailModal entry={fileEntry} description="x" onClose={() => {}} onCreated={() => {}} />,
    );
    fireEvent.click(screen.getByTestId("scope-all-agents"));
    const body = await submitAndReadBody();
    expect((body.selector as { agent: string | null }).agent).toBeNull();
  });

  it("scope='agent' (default) sends entry.agentId on selector.agent", async () => {
    mockOk();
    render(
      <GuardrailModal entry={fileEntry} description="x" onClose={() => {}} onCreated={() => {}} />,
    );
    const body = await submitAndReadBody();
    expect((body.selector as { agent: string | null }).agent).toBe("alpha");
  });

  it("source + riskScore exactly mirror v1 wiring", async () => {
    mockOk();
    render(
      <GuardrailModal entry={fileEntry} description="x" onClose={() => {}} onCreated={() => {}} />,
    );
    const body = await submitAndReadBody();
    expect(body.source).toEqual({
      toolCallId: "tc_file",
      sessionKey: "sk_2",
      agentId: "alpha",
    });
    expect(body.riskScore).toBe(70);
  });
});

// ── Phase 2.5 — cosmetic / regression ──────────────────

describe("GuardrailModal — cosmetic regression (§5.5)", () => {
  it("title is 'Add guardrail' (sentence case, replaces uppercase v1 title)", () => {
    render(
      <GuardrailModal entry={entry} description="x" onClose={() => {}} onCreated={() => {}} />,
    );
    const title = screen.getByTestId("modal-title");
    expect(title.textContent).toBe("Add guardrail");
  });

  it("renders a per-action blurb under each ActionOption row", () => {
    render(
      <GuardrailModal entry={entry} description="x" onClose={() => {}} onCreated={() => {}} />,
    );
    const blockRow = screen.getByTestId("action-row-block");
    const reqRow = screen.getByTestId("action-row-require_approval");
    const allowRow = screen.getByTestId("action-row-allow_notify");
    expect(blockRow.textContent).toContain("Calls never reach the tool.");
    expect(reqRow.textContent).toContain("Pause and notify; you decide.");
    expect(allowRow.textContent).toContain("Pass through, audit on the side.");
  });

  it("ScopeToggle 'this agent' sub-label displays entry.agentId", () => {
    render(
      <GuardrailModal entry={fileEntry} description="x" onClose={() => {}} onCreated={() => {}} />,
    );
    const scope = screen.getByTestId("scope-this-agent");
    expect(scope.textContent).toContain("alpha");
  });
});
