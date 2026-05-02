// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Guardrail } from "../dashboard/src/lib/types";
import Guardrails from "../dashboard/src/pages/Guardrails";

function rule(o: Partial<Guardrail> & Pick<Guardrail, "id">): Guardrail {
  return {
    id: o.id,
    selector: o.selector ?? { agent: null, tools: { mode: "names", values: ["exec"] } },
    target: o.target ?? { kind: "command-glob", pattern: "rm -rf *" },
    action: o.action ?? "block",
    description: o.description ?? "test",
    createdAt: o.createdAt ?? "2026-04-01T00:00:00.000Z",
    source: o.source ?? { toolCallId: "tc", sessionKey: "sk", agentId: "alpha" },
    riskScore: o.riskScore ?? 50,
    note: o.note,
    hits24h: o.hits24h,
    hits7d: o.hits7d,
    lastFiredAt: o.lastFiredAt,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

function mockGuardrailsResponse(rules: Guardrail[]) {
  fetchMock.mockImplementation((url: string) => {
    if (typeof url === "string" && url.includes("/api/guardrails/") && url.endsWith("/stats")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ id: "x", hits24h: 0, lastFiredAt: null, sparkline: [] }),
      });
    }
    if (typeof url === "string" && url.includes("/api/guardrails/") && url.includes("/firings")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ firings: [] }) });
    }
    if (typeof url === "string" && url.endsWith("/api/guardrails")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ guardrails: rules }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/guardrails"]}>
      <Guardrails />
    </MemoryRouter>,
  );
}

describe("Guardrails page", () => {
  it("renders the empty-state heading when no rule is selected", async () => {
    mockGuardrailsResponse([
      rule({ id: "g1", action: "block", target: { kind: "path-glob", pattern: "/etc/secrets/*" } }),
    ]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Pick a guardrail/i })).toBeInTheDocument();
    });
  });

  it("opens the detail pane when a list row is clicked", async () => {
    mockGuardrailsResponse([
      rule({
        id: "g_detail",
        action: "block",
        target: { kind: "path-glob", pattern: "/etc/secrets/api.env" },
      }),
    ]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("guardrail-row-g_detail")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("guardrail-row-g_detail"));
    await waitFor(() => {
      expect(screen.getByTestId("detail-resource")).toBeInTheDocument();
      expect(screen.getByTestId("detail-resource").textContent).toBe("/etc/secrets/api.env");
    });
  });

  it("filtering by action narrows the visible list (block-only hides require_approval)", async () => {
    mockGuardrailsResponse([
      rule({
        id: "g_block",
        action: "block",
        target: { kind: "path-glob", pattern: "/a" },
      }),
      rule({
        id: "g_approval",
        action: "require_approval",
        target: { kind: "path-glob", pattern: "/b" },
      }),
    ]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("guardrail-row-g_block")).toBeInTheDocument();
      expect(screen.getByTestId("guardrail-row-g_approval")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("opt-action-block"));
    expect(screen.queryByTestId("guardrail-row-g_approval")).toBeNull();
    expect(screen.getByTestId("guardrail-row-g_block")).toBeInTheDocument();
  });

  it("recently-fired entry in the empty state selects that rule when clicked", async () => {
    mockGuardrailsResponse([
      rule({
        id: "g_fired",
        action: "block",
        target: { kind: "path-glob", pattern: "/etc/x" },
        lastFiredAt: new Date(Date.now() - 60_000).toISOString(),
      }),
    ]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("recent-fired-g_fired")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("recent-fired-g_fired"));
    await waitFor(() => {
      expect(screen.getByTestId("detail-resource")).toBeInTheDocument();
    });
  });

  it("zero rules total renders the 'no guardrails yet' empty list copy", async () => {
    mockGuardrailsResponse([]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/No guardrails yet/i)).toBeInTheDocument();
    });
  });
});
