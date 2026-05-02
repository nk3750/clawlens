// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GuardrailDetailPane, {
  type PatchBody,
} from "../dashboard/src/components/guardrails/GuardrailDetailPane";
import GuardrailListRow from "../dashboard/src/components/guardrails/GuardrailListRow";
import type { Guardrail } from "../dashboard/src/lib/types";

function rule(o: Partial<Guardrail> & Pick<Guardrail, "id">): Guardrail {
  return {
    id: o.id,
    selector: o.selector ?? { agent: null, tools: { mode: "names", values: ["write"] } },
    target: o.target ?? { kind: "path-glob", pattern: "/etc/secrets/api.env" },
    action: o.action ?? "block",
    description: o.description ?? "test",
    createdAt: o.createdAt ?? new Date(Date.now() - 60_000).toISOString(),
    source: o.source ?? { toolCallId: "tc", sessionKey: "sk", agentId: "alpha" },
    riskScore: o.riskScore ?? 60,
    note: o.note,
    hits24h: o.hits24h,
    hits7d: o.hits7d,
    lastFiredAt: o.lastFiredAt,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockImplementation(() =>
    Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({ id: "x", hits24h: 0, lastFiredAt: null, sparkline: [], firings: [] }),
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderDetail(
  r: Guardrail,
  opts: {
    onPatch?: (patch: PatchBody) => Promise<void>;
    onDelete?: () => Promise<void>;
  } = {},
) {
  return render(
    <MemoryRouter initialEntries={["/guardrails"]}>
      <GuardrailDetailPane
        rule={r}
        onPatch={opts.onPatch ?? (() => Promise.resolve())}
        onDelete={opts.onDelete ?? (() => Promise.resolve())}
      />
    </MemoryRouter>,
  );
}

describe("GuardrailDetailPane — verb chip + action + scope PATCH dispatch", () => {
  it("clicking a verb chip fires PATCH with the new tools.values array (toggle on)", async () => {
    const onPatch = vi.fn().mockResolvedValue(undefined);
    renderDetail(
      rule({
        id: "g1",
        selector: { agent: null, tools: { mode: "names", values: ["write"] } },
        target: { kind: "path-glob", pattern: "/x" },
      }),
      { onPatch },
    );
    fireEvent.click(screen.getByText("EDIT"));
    expect(onPatch).toHaveBeenCalledTimes(1);
    const arg = onPatch.mock.calls[0][0] as PatchBody;
    expect(arg.tools).toBeDefined();
    const values = arg.tools?.values ?? [];
    expect(values.sort()).toEqual(["edit", "write"].sort());
  });

  it("clicking an active verb chip removes it from the values array", async () => {
    const onPatch = vi.fn().mockResolvedValue(undefined);
    renderDetail(
      rule({
        id: "g1",
        selector: { agent: null, tools: { mode: "names", values: ["write", "edit"] } },
        target: { kind: "path-glob", pattern: "/x" },
      }),
      { onPatch },
    );
    fireEvent.click(screen.getByText("EDIT"));
    const arg = onPatch.mock.calls[0][0] as PatchBody;
    expect(arg.tools?.values).toEqual(["write"]);
  });

  it("does NOT fire a PATCH that would empty tools.values (shows error instead)", async () => {
    const onPatch = vi.fn().mockResolvedValue(undefined);
    renderDetail(
      rule({
        id: "g1",
        selector: { agent: null, tools: { mode: "names", values: ["write"] } },
        target: { kind: "path-glob", pattern: "/x" },
      }),
      { onPatch },
    );
    fireEvent.click(screen.getByText("WRITE"));
    expect(onPatch).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/at least one verb/i);
  });

  it("clicking an action button fires PATCH with { action: nextAction }", async () => {
    const onPatch = vi.fn().mockResolvedValue(undefined);
    renderDetail(rule({ id: "g1", action: "block" }), { onPatch });
    fireEvent.click(screen.getByTestId("action-require_approval"));
    expect(onPatch).toHaveBeenCalledWith({ action: "require_approval" });
  });

  it("clicking [this agent] on a global rule (selector.agent === null) PATCHes { agent: rule.source.agentId }", async () => {
    const onPatch = vi.fn().mockResolvedValue(undefined);
    renderDetail(
      rule({
        id: "g1",
        selector: { agent: null, tools: { mode: "names", values: ["exec"] } },
        source: { toolCallId: "tc", sessionKey: "sk", agentId: "goose" },
      }),
      { onPatch },
    );
    fireEvent.click(screen.getByTestId("scope-this-agent"));
    expect(onPatch).toHaveBeenCalledWith({ agent: "goose" });
  });

  it("clicking [this agent] on a per-agent rule preserves the existing narrowing", async () => {
    const onPatch = vi.fn().mockResolvedValue(undefined);
    renderDetail(
      rule({
        id: "g1",
        selector: { agent: "goose", tools: { mode: "names", values: ["exec"] } },
        source: { toolCallId: "tc", sessionKey: "sk", agentId: "alpha" },
      }),
      { onPatch },
    );
    fireEvent.click(screen.getByTestId("scope-this-agent"));
    // Sends the existing agent — preserves narrowing, doesn't fall back to source.agentId
    expect(onPatch).toHaveBeenCalledWith({ agent: "goose" });
  });

  it("clicking [all agents] PATCHes { agent: null } from any starting state", async () => {
    const onPatch = vi.fn().mockResolvedValue(undefined);
    renderDetail(
      rule({
        id: "g1",
        selector: { agent: "goose", tools: { mode: "names", values: ["exec"] } },
      }),
      { onPatch },
    );
    fireEvent.click(screen.getByTestId("scope-all-agents"));
    expect(onPatch).toHaveBeenCalledWith({ agent: null });
  });

  it("active state of scope buttons reflects selector.agent", async () => {
    // Global rule → [all agents] active
    const { rerender } = renderDetail(
      rule({ id: "g_global", selector: { agent: null, tools: { mode: "any" } } }),
    );
    expect(screen.getByTestId("scope-all-agents").getAttribute("data-active")).toBe("true");
    expect(screen.getByTestId("scope-this-agent").getAttribute("data-active")).toBe("false");

    // Re-render with per-agent rule
    rerender(
      <MemoryRouter initialEntries={["/guardrails"]}>
        <GuardrailDetailPane
          rule={rule({ id: "g_agent", selector: { agent: "alpha", tools: { mode: "any" } } })}
          onPatch={() => Promise.resolve()}
          onDelete={() => Promise.resolve()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("scope-all-agents").getAttribute("data-active")).toBe("false");
    expect(screen.getByTestId("scope-this-agent").getAttribute("data-active")).toBe("true");
  });
});

describe("GuardrailDetailPane — pattern + note inputs", () => {
  it("pattern input PATCHes on blur with { target: { pattern: nextValue } }", async () => {
    const onPatch = vi.fn().mockResolvedValue(undefined);
    renderDetail(
      rule({
        id: "g_p",
        target: { kind: "command-glob", pattern: "rm -rf *" },
      }),
      { onPatch },
    );
    const input = screen.getByTestId("pattern-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "rm -rf node_modules" } });
    fireEvent.blur(input);
    expect(onPatch).toHaveBeenCalledWith({ target: { pattern: "rm -rf node_modules" } });
  });

  it("pattern input does NOT PATCH on blur when value is unchanged", async () => {
    const onPatch = vi.fn().mockResolvedValue(undefined);
    renderDetail(rule({ id: "g_p", target: { kind: "command-glob", pattern: "rm -rf *" } }), {
      onPatch,
    });
    const input = screen.getByTestId("pattern-input") as HTMLInputElement;
    fireEvent.blur(input);
    expect(onPatch).not.toHaveBeenCalled();
  });

  it("note textarea PATCHes on blur with { note: nextValue }", async () => {
    const onPatch = vi.fn().mockResolvedValue(undefined);
    renderDetail(rule({ id: "g_n", note: "before" }), { onPatch });
    const ta = screen.getByTestId("note-textarea") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "after" } });
    fireEvent.blur(ta);
    expect(onPatch).toHaveBeenCalledWith({ note: "after" });
  });

  it("PATCH 400 reverts the pattern input back to the rule's value", async () => {
    const onPatch = vi.fn().mockRejectedValue(new Error("validation failed"));
    renderDetail(rule({ id: "g_p", target: { kind: "command-glob", pattern: "original" } }), {
      onPatch,
    });
    const input = screen.getByTestId("pattern-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "edited" } });
    fireEvent.blur(input);
    // Wait for the rejection to be processed.
    await Promise.resolve();
    await Promise.resolve();
    expect(input.value).toBe("original");
  });
});

describe("GuardrailDetailPane — disabled states for advanced (identity-glob) and non-names modes", () => {
  it("identity-glob rule disables the verb picker AND the pattern input + shows hints", () => {
    renderDetail(
      rule({
        id: "g_id",
        target: { kind: "identity-glob", pattern: "rm -rf node_modules" },
        selector: { agent: null, tools: { mode: "names", values: ["exec"] } },
      }),
    );
    // Pattern input disabled
    const input = screen.getByTestId("pattern-input") as HTMLInputElement;
    expect(input.disabled).toBe(true);
    // Verb picker hint visible
    expect(screen.getByTestId("verbs-disabled-hint").textContent).toMatch(/Identity rules/i);
  });

  it("category-mode rule disables verb picker (with mode hint) and keeps pattern input enabled", () => {
    renderDetail(
      rule({
        id: "g_cat",
        target: { kind: "path-glob", pattern: "/a" },
        selector: { agent: null, tools: { mode: "category", value: "changes" } },
      }),
    );
    expect(screen.getByTestId("verbs-disabled-hint").textContent).toMatch(/names-mode/i);
    expect((screen.getByTestId("pattern-input") as HTMLInputElement).disabled).toBe(false);
  });
});

describe("GuardrailDetailPane — view source activity link", () => {
  it("href is /activity with no query string", () => {
    renderDetail(rule({ id: "g_link" }));
    const link = screen.getByTestId("view-source-activity") as HTMLAnchorElement;
    // MemoryRouter renders the relative pathname into href.
    expect(link.getAttribute("href")).toBe("/activity");
  });
});

// ── List-row hits rendering (per spec §7.2 — listed under detail-pane) ──

describe("GuardrailListRow — hits24h vs no-hits-yet rendering", () => {
  it("renders '{hits24h} hits · {relTime}' when hits24h > 0 and lastFiredAt is set", () => {
    render(
      <GuardrailListRow
        rule={rule({
          id: "g_hits",
          hits24h: 14,
          lastFiredAt: new Date(Date.now() - 2 * 60_000).toISOString(),
        })}
        selected={false}
        onSelect={() => {}}
      />,
    );
    const text = screen.getByText(/14 hits/);
    expect(text.textContent).toMatch(/14 hits · 2m ago/);
  });

  it("renders 'no hits yet' when hits24h === 0", () => {
    render(
      <GuardrailListRow
        rule={rule({ id: "g_quiet", hits24h: 0, lastFiredAt: null })}
        selected={false}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText("no hits yet")).toBeInTheDocument();
  });
});
