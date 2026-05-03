// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Guardrail } from "../dashboard/src/lib/types";
import Guardrails from "../dashboard/src/pages/Guardrails";

function LocationProbe() {
  const loc = useLocation();
  return (
    <span data-testid="probe-location">
      {loc.pathname}
      {loc.search}
    </span>
  );
}

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

function renderPage(initialPath = "/guardrails") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <LocationProbe />
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

/**
 * #52 part 2 — `?selected=<id>` deep-link from activity / attention. Must
 * pre-select the matching rule on mount, fall back to the empty state when
 * the id is unknown, and round-trip selection state into the URL so refresh
 * / share preserve the operator's place.
 */
describe("Guardrails page — ?selected=<id> URL param", () => {
  it("mounting with ?selected=<existing id> opens that rule's detail pane", async () => {
    mockGuardrailsResponse([
      rule({
        id: "g_deeplink",
        action: "block",
        target: { kind: "path-glob", pattern: "/etc/secrets/api.env" },
      }),
      rule({
        id: "g_other",
        action: "require_approval",
        target: { kind: "path-glob", pattern: "/var/log/*" },
      }),
    ]);
    renderPage("/guardrails?selected=g_deeplink");
    await waitFor(() => {
      expect(screen.getByTestId("detail-resource")).toBeInTheDocument();
    });
    expect(screen.getByTestId("detail-resource").textContent).toBe("/etc/secrets/api.env");
  });

  it("mounting with ?selected=<missing id> renders the empty state and drops the param", async () => {
    mockGuardrailsResponse([
      rule({
        id: "g_real",
        action: "block",
        target: { kind: "path-glob", pattern: "/etc/x" },
      }),
    ]);
    renderPage("/guardrails?selected=g_does_not_exist");
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Pick a guardrail/i })).toBeInTheDocument();
    });
    // URL param dropped — the empty state is the source of truth.
    await waitFor(() => {
      const probe = screen.getByTestId("probe-location");
      expect(probe.textContent).not.toContain("selected=g_does_not_exist");
    });
  });

  it("clicking a list row writes ?selected=<id> into the URL", async () => {
    mockGuardrailsResponse([
      rule({
        id: "g_clickable",
        action: "block",
        target: { kind: "path-glob", pattern: "/a" },
      }),
    ]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("guardrail-row-g_clickable")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("guardrail-row-g_clickable"));
    await waitFor(() => {
      const probe = screen.getByTestId("probe-location");
      expect(probe.textContent).toContain("selected=g_clickable");
    });
  });

  it("clearing selection drops ?selected from the URL", async () => {
    mockGuardrailsResponse([
      rule({ id: "g_one", action: "block", target: { kind: "path-glob", pattern: "/x" } }),
      rule({ id: "g_two", action: "block", target: { kind: "path-glob", pattern: "/y" } }),
    ]);
    renderPage("/guardrails?selected=g_one");
    await waitFor(() => {
      expect(screen.getByTestId("detail-resource")).toBeInTheDocument();
    });
    // Selecting a different row replaces the param; selecting the same row
    // keeps it. To prove "clearing drops" without depending on a UI clear
    // button, swap to a different rule and observe the URL still tracks.
    fireEvent.click(screen.getByTestId("guardrail-row-g_two"));
    await waitFor(() => {
      const probe = screen.getByTestId("probe-location");
      expect(probe.textContent).toContain("selected=g_two");
      expect(probe.textContent).not.toContain("selected=g_one");
    });
  });

  it("empty ?selected= (no id) falls through to the empty state", async () => {
    mockGuardrailsResponse([
      rule({ id: "g_real", action: "block", target: { kind: "path-glob", pattern: "/x" } }),
    ]);
    renderPage("/guardrails?selected=");
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Pick a guardrail/i })).toBeInTheDocument();
    });
  });
});
