// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ActivityRow from "../dashboard/src/components/activity/ActivityRow";
import type { ActivityCategory, EntryResponse } from "../dashboard/src/lib/types";

const NOW = new Date("2026-04-26T18:00:00.000Z").getTime();

function entry(overrides: Partial<EntryResponse> = {}): EntryResponse {
  return {
    timestamp: new Date(NOW - 30 * 1000).toISOString(),
    toolName: "exec",
    toolCallId: "tc_1",
    params: { command: "rm -rf /tmp/cache" },
    effectiveDecision: "allow",
    category: "scripts" as ActivityCategory,
    agentId: "baddie",
    sessionKey: "agent:baddie:session:abc#1",
    riskTier: "high",
    riskScore: 60,
    originalRiskScore: 35,
    riskTags: ["destructive"],
    llmEvaluation: {
      adjustedScore: 60,
      reasoning: "Removes a directory",
      tags: ["destructive"],
      confidence: "high",
      patterns: [],
    },
    ...overrides,
  };
}

function LocationProbe() {
  const loc = useLocation();
  return (
    <span data-testid="probe-location">
      {loc.pathname}
      {loc.search}
    </span>
  );
}

function renderRow(
  props: {
    entry?: EntryResponse;
    isExpanded?: boolean;
    onToggleExpand?: () => void;
    onChip?: (key: "agent" | "tier", value: string) => void;
    isNew?: boolean;
  } = {},
) {
  const e = props.entry ?? entry();
  const isExpanded = props.isExpanded ?? false;
  const onToggleExpand = props.onToggleExpand ?? vi.fn();
  const onChip = props.onChip ?? vi.fn();
  const isNew = props.isNew ?? false;
  return render(
    <MemoryRouter initialEntries={["/activity"]}>
      <LocationProbe />
      <Routes>
        <Route
          path="/activity"
          element={
            <ActivityRow
              entry={e}
              isNew={isNew}
              onChip={onChip}
              isExpanded={isExpanded}
              onToggleExpand={onToggleExpand}
            />
          }
        />
        <Route
          path="/session/:sessionKey"
          element={<div data-testid="session-page">session</div>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

let writeTextSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeTextSpy = vi.fn();
  Object.assign(navigator, { clipboard: { writeText: writeTextSpy } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ActivityRow — click-to-expand", () => {
  it("does not render the expanded body when isExpanded=false", () => {
    renderRow({ isExpanded: false });
    expect(screen.queryByTestId("activity-row-expanded")).toBeNull();
  });

  it("renders the expanded body when isExpanded=true", () => {
    renderRow({ isExpanded: true });
    expect(screen.getByTestId("activity-row-expanded")).toBeInTheDocument();
  });

  it("clicking the row root fires onToggleExpand", () => {
    const onToggleExpand = vi.fn();
    renderRow({ onToggleExpand });
    fireEvent.click(screen.getByTestId("activity-row-root"));
    expect(onToggleExpand).toHaveBeenCalledTimes(1);
  });

  it("pressing Enter on the focused row root fires onToggleExpand", () => {
    const onToggleExpand = vi.fn();
    renderRow({ onToggleExpand });
    fireEvent.keyDown(screen.getByTestId("activity-row-root"), { key: "Enter" });
    expect(onToggleExpand).toHaveBeenCalledTimes(1);
  });

  it("pressing Space on the focused row root fires onToggleExpand and prevents default", () => {
    const onToggleExpand = vi.fn();
    renderRow({ onToggleExpand });
    const root = screen.getByTestId("activity-row-root");
    const evt = fireEvent.keyDown(root, { key: " " });
    expect(onToggleExpand).toHaveBeenCalledTimes(1);
    // fireEvent returns whether the event was not cancelled; with preventDefault → false
    expect(evt).toBe(false);
  });

  it("the row root is focusable and announces button semantics", () => {
    renderRow();
    const root = screen.getByTestId("activity-row-root");
    expect(root.getAttribute("role")).toBe("button");
    expect(root.getAttribute("tabindex")).toBe("0");
  });
});

describe("ActivityRow — single-expanded-at-a-time (parent state contract)", () => {
  /**
   * Drives the parent contract: ActivityFeed owns expandedId. Toggling row B
   * must replace row A's expanded state, not coexist. This is asserted by
   * exercising the parent component's state transitions through a tiny
   * harness mirroring ActivityFeed's lifting.
   */
  function Harness() {
    const a = entry({ toolCallId: "row-a", params: { command: "echo a" } });
    const b = entry({ toolCallId: "row-b", params: { command: "echo b" } });
    const [expandedId, setExpandedId] = (
      window as unknown as {
        __react: typeof import("react");
      }
    ).__react.useState<string | null>(null);
    const toggle = (id: string) =>
      setExpandedId((prev: string | null) => (prev === id ? null : id));
    return (
      <>
        <ActivityRow
          entry={a}
          isNew={false}
          onChip={vi.fn()}
          isExpanded={expandedId === "row-a"}
          onToggleExpand={() => toggle("row-a")}
        />
        <ActivityRow
          entry={b}
          isNew={false}
          onChip={vi.fn()}
          isExpanded={expandedId === "row-b"}
          onToggleExpand={() => toggle("row-b")}
        />
      </>
    );
  }

  it("clicking row B while row A is expanded collapses A and expands B", async () => {
    // Make React available to the harness without static import duplication.
    const React = await import("react");
    (window as unknown as { __react: typeof React }).__react = React;

    render(
      <MemoryRouter initialEntries={["/activity"]}>
        <Harness />
      </MemoryRouter>,
    );

    const roots = screen.getAllByTestId("activity-row-root");
    expect(roots.length).toBe(2);
    const [rootA, rootB] = roots;

    // Initially: neither is expanded.
    expect(screen.queryByTestId("activity-row-expanded")).toBeNull();

    // Click A → A expands.
    fireEvent.click(rootA);
    let bodies = screen.getAllByTestId("activity-row-expanded");
    expect(bodies.length).toBe(1);
    expect(rootA.getAttribute("aria-expanded")).toBe("true");
    expect(rootB.getAttribute("aria-expanded")).toBe("false");

    // Click B → A collapses, B expands.
    fireEvent.click(rootB);
    bodies = screen.getAllByTestId("activity-row-expanded");
    expect(bodies.length).toBe(1);
    expect(rootA.getAttribute("aria-expanded")).toBe("false");
    expect(rootB.getAttribute("aria-expanded")).toBe("true");

    // Click B again → collapses.
    fireEvent.click(rootB);
    expect(screen.queryByTestId("activity-row-expanded")).toBeNull();
  });
});

describe("ActivityRow — expanded body content", () => {
  it("shows score, tier label, and tag-derived sentence in risk reasoning", () => {
    renderRow({
      entry: entry({
        riskScore: 80,
        riskTier: "critical",
        originalRiskScore: 50,
        riskTags: ["destructive"],
      }),
      isExpanded: true,
    });
    const reasoning = screen.getByTestId("activity-row-reasoning");
    expect(reasoning.textContent).toMatch(/80/);
    expect(reasoning.textContent).toMatch(/CRITICAL/i);
    expect(reasoning.textContent).toMatch(/Destructive operation/);
  });

  it("includes the static-vs-LLM contribution split when llmEvaluation is present", () => {
    renderRow({
      entry: entry({
        riskScore: 60,
        originalRiskScore: 35,
        llmEvaluation: {
          adjustedScore: 60,
          reasoning: "Bumped",
          tags: ["destructive"],
          confidence: "high",
          patterns: [],
        },
      }),
      isExpanded: true,
    });
    const reasoning = screen.getByTestId("activity-row-reasoning");
    expect(reasoning.textContent).toMatch(/Static rules contributed 35/);
    expect(reasoning.textContent).toMatch(/LLM classifier contributed 25/);
  });

  it("renders 'reduced by N' when the LLM lowered the static score", () => {
    renderRow({
      entry: entry({
        riskScore: 72,
        originalRiskScore: 75,
        llmEvaluation: {
          adjustedScore: 72,
          reasoning: "Lower than static thought",
          tags: [],
          confidence: "high",
          patterns: [],
        },
      }),
      isExpanded: true,
    });
    const reasoning = screen.getByTestId("activity-row-reasoning");
    expect(reasoning.textContent).toMatch(/Static rules contributed 75/);
    expect(reasoning.textContent).toMatch(/LLM classifier reduced by 3/);
    // Must not silently degrade to "contributed 0" or any positive-side prose.
    expect(reasoning.textContent).not.toMatch(/LLM classifier contributed/);
  });

  it("renders 'matched static rules' when the LLM agreed with the static score", () => {
    renderRow({
      entry: entry({
        riskScore: 50,
        originalRiskScore: 50,
        llmEvaluation: {
          adjustedScore: 50,
          reasoning: "Concur",
          tags: [],
          confidence: "high",
          patterns: [],
        },
      }),
      isExpanded: true,
    });
    const reasoning = screen.getByTestId("activity-row-reasoning");
    expect(reasoning.textContent).toMatch(/Static rules contributed 50/);
    expect(reasoning.textContent).toMatch(/LLM classifier matched static rules/);
    expect(reasoning.textContent).not.toMatch(/LLM classifier contributed/);
    expect(reasoning.textContent).not.toMatch(/reduced by/);
  });

  it("omits the contribution-split sentence when llmEvaluation is absent", () => {
    renderRow({
      entry: entry({ llmEvaluation: undefined, originalRiskScore: undefined }),
      isExpanded: true,
    });
    const reasoning = screen.getByTestId("activity-row-reasoning");
    expect(reasoning.textContent).not.toMatch(/Static rules contributed/);
    expect(reasoning.textContent).not.toMatch(/LLM classifier/);
  });

  it("omits the tag sentence when riskTags is empty", () => {
    renderRow({
      entry: entry({ riskTags: [] }),
      isExpanded: true,
    });
    const reasoning = screen.getByTestId("activity-row-reasoning");
    expect(reasoning.textContent).not.toMatch(/Destructive/);
  });

  it("renders the raw command in mono on dark surface", () => {
    renderRow({
      entry: entry({ params: { command: "rm -rf /tmp/cache" } }),
      isExpanded: true,
    });
    const raw = screen.getByTestId("activity-row-raw");
    expect(raw.textContent).toMatch(/\$ rm -rf \/tmp\/cache/);
  });

  it("falls back to toolName in raw when params has no command", () => {
    renderRow({
      entry: entry({ toolName: "read", params: { path: "/etc/passwd" } }),
      isExpanded: true,
    });
    const raw = screen.getByTestId("activity-row-raw");
    expect(raw.textContent).toMatch(/\$ read/);
  });

  it("renders session and id chips below the raw block", () => {
    renderRow({
      entry: entry({ sessionKey: "agent:baddie:session:abc#1", toolCallId: "tc_xyz" }),
      isExpanded: true,
    });
    const expanded = screen.getByTestId("activity-row-expanded");
    expect(expanded.textContent).toMatch(/session/);
    expect(expanded.textContent).toMatch(/agent:baddie:session:abc#1/);
    expect(expanded.textContent).toMatch(/tc_xyz/);
  });
});

describe("ActivityRow — expanded panel buttons", () => {
  it("clicking copy in the expanded panel writes the command to clipboard and does not toggle", () => {
    const onToggleExpand = vi.fn();
    renderRow({
      entry: entry({ params: { command: "ssh prod" } }),
      isExpanded: true,
      onToggleExpand,
    });
    fireEvent.click(screen.getByTestId("activity-row-expanded-copy"));
    expect(writeTextSpy).toHaveBeenCalledWith("ssh prod");
    expect(onToggleExpand).not.toHaveBeenCalled();
  });

  it("clicking open-session in the expanded panel navigates to /session/<encodedSessionKey>", () => {
    const onToggleExpand = vi.fn();
    renderRow({
      entry: entry({ sessionKey: "agent:baddie:session:abc#1" }),
      isExpanded: true,
      onToggleExpand,
    });
    fireEvent.click(screen.getByTestId("activity-row-expanded-open-session"));
    const probe = screen.getByTestId("probe-location");
    // Encoded: ":" → %3A, "#" → %23
    expect(probe.textContent).toContain(
      `/session/${encodeURIComponent("agent:baddie:session:abc#1")}`,
    );
    expect(onToggleExpand).not.toHaveBeenCalled();
  });

  it("open-session button is disabled when sessionKey is absent", () => {
    renderRow({
      entry: entry({ sessionKey: undefined }),
      isExpanded: true,
    });
    const btn = screen.getByTestId("activity-row-expanded-open-session") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("add-guardrail button in expanded panel is enabled with title='add guardrail' (Phase 2.6)", () => {
    renderRow({ isExpanded: true });
    const btn = screen.getByTestId("activity-row-expanded-add-guardrail") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.title).toBe("add guardrail");
  });

  it("clicking the add-guardrail in the expanded panel does not toggle the row", () => {
    const onToggleExpand = vi.fn();
    renderRow({ isExpanded: true, onToggleExpand });
    const btn = screen.getByTestId("activity-row-expanded-add-guardrail") as HTMLButtonElement;
    fireEvent.click(btn);
    expect(onToggleExpand).not.toHaveBeenCalled();
  });
});

describe("ActivityRow — hover quick-actions", () => {
  it("does not render quick-actions before hover", () => {
    renderRow();
    expect(screen.queryByTestId("activity-row-quick-actions")).toBeNull();
  });

  it("hovering the row reveals the quick-actions strip when not expanded", () => {
    renderRow();
    fireEvent.mouseEnter(screen.getByTestId("activity-row-root"));
    expect(screen.getByTestId("activity-row-quick-actions")).toBeInTheDocument();
  });

  it("mouse leave hides the quick-actions strip", () => {
    renderRow();
    const root = screen.getByTestId("activity-row-root");
    fireEvent.mouseEnter(root);
    expect(screen.getByTestId("activity-row-quick-actions")).toBeInTheDocument();
    fireEvent.mouseLeave(root);
    expect(screen.queryByTestId("activity-row-quick-actions")).toBeNull();
  });

  it("hovering an expanded row does NOT reveal quick-actions (per spec)", () => {
    renderRow({ isExpanded: true });
    fireEvent.mouseEnter(screen.getByTestId("activity-row-root"));
    expect(screen.queryByTestId("activity-row-quick-actions")).toBeNull();
  });

  it("clicking the copy quick-action writes to clipboard and does NOT toggle the row", () => {
    const onToggleExpand = vi.fn();
    renderRow({
      entry: entry({ params: { command: "git push --force" } }),
      onToggleExpand,
    });
    fireEvent.mouseEnter(screen.getByTestId("activity-row-root"));
    const qa = screen.getByTestId("activity-row-quick-actions");
    fireEvent.click(within(qa).getByTestId("activity-row-quick-copy"));
    expect(writeTextSpy).toHaveBeenCalledWith("git push --force");
    expect(onToggleExpand).not.toHaveBeenCalled();
  });

  it("clicking the open-session quick-action navigates and does NOT toggle the row", () => {
    const onToggleExpand = vi.fn();
    renderRow({
      entry: entry({ sessionKey: "agent:baddie:session:xyz#1" }),
      onToggleExpand,
    });
    fireEvent.mouseEnter(screen.getByTestId("activity-row-root"));
    const qa = screen.getByTestId("activity-row-quick-actions");
    fireEvent.click(within(qa).getByTestId("activity-row-quick-open-session"));
    const probe = screen.getByTestId("probe-location");
    expect(probe.textContent).toContain(
      `/session/${encodeURIComponent("agent:baddie:session:xyz#1")}`,
    );
    expect(onToggleExpand).not.toHaveBeenCalled();
  });

  it("open-session quick-action is disabled when sessionKey is absent", () => {
    renderRow({ entry: entry({ sessionKey: undefined }) });
    fireEvent.mouseEnter(screen.getByTestId("activity-row-root"));
    const qa = screen.getByTestId("activity-row-quick-actions");
    const btn = within(qa).getByTestId("activity-row-quick-open-session") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("add-guardrail quick-action is enabled with title='add guardrail' (Phase 2.6)", () => {
    renderRow();
    fireEvent.mouseEnter(screen.getByTestId("activity-row-root"));
    const qa = screen.getByTestId("activity-row-quick-actions");
    const btn = within(qa).getByTestId("activity-row-quick-add-guardrail") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.title).toBe("add guardrail");
  });

  it("clicking the add-guardrail quick-action does not toggle the row", () => {
    const onToggleExpand = vi.fn();
    renderRow({ onToggleExpand });
    fireEvent.mouseEnter(screen.getByTestId("activity-row-root"));
    const qa = screen.getByTestId("activity-row-quick-actions");
    const btn = within(qa).getByTestId("activity-row-quick-add-guardrail") as HTMLButtonElement;
    fireEvent.click(btn);
    expect(onToggleExpand).not.toHaveBeenCalled();
  });
});

describe("ActivityRow — smart shield button (#52)", () => {
  it("expanded panel button reads 'see guardrail' when entry.guardrailMatch is set", () => {
    renderRow({
      entry: entry({ guardrailMatch: { id: "g_match_1", action: "block" } }),
      isExpanded: true,
    });
    const btn = screen.getByTestId("activity-row-expanded-add-guardrail") as HTMLButtonElement;
    expect(btn.title).toBe("see guardrail (block)");
    expect(btn.textContent?.trim()).toBe("see guardrail");
  });

  it("clicking the expanded panel button navigates to /guardrails?selected=<id> when match exists", () => {
    renderRow({
      entry: entry({ guardrailMatch: { id: "g_match_2", action: "require_approval" } }),
      isExpanded: true,
    });
    fireEvent.click(screen.getByTestId("activity-row-expanded-add-guardrail"));
    const probe = screen.getByTestId("probe-location");
    expect(probe.textContent).toContain(`/guardrails?selected=${encodeURIComponent("g_match_2")}`);
  });

  it("hover quick-action shield reads 'see guardrail (action)' when match exists", () => {
    renderRow({ entry: entry({ guardrailMatch: { id: "g_qa", action: "allow_notify" } }) });
    fireEvent.mouseEnter(screen.getByTestId("activity-row-root"));
    const btn = screen.getByTestId("activity-row-quick-add-guardrail") as HTMLButtonElement;
    expect(btn.title).toBe("see guardrail (allow_notify)");
  });

  it("clicking the hover quick-action shield navigates when match exists", () => {
    renderRow({ entry: entry({ guardrailMatch: { id: "g_qa_click", action: "block" } }) });
    fireEvent.mouseEnter(screen.getByTestId("activity-row-root"));
    fireEvent.click(screen.getByTestId("activity-row-quick-add-guardrail"));
    const probe = screen.getByTestId("probe-location");
    expect(probe.textContent).toContain(`/guardrails?selected=${encodeURIComponent("g_qa_click")}`);
  });

  it("falls back to add-guardrail behavior in both surfaces when no match", () => {
    renderRow({ isExpanded: true });
    const expBtn = screen.getByTestId("activity-row-expanded-add-guardrail") as HTMLButtonElement;
    expect(expBtn.title).toBe("add guardrail");
  });
});

describe("ActivityRow — clipboard fallback", () => {
  it("copy quick-action no-ops gracefully when navigator.clipboard is unavailable", () => {
    Object.assign(navigator, { clipboard: undefined });
    const onToggleExpand = vi.fn();
    renderRow({ onToggleExpand });
    fireEvent.mouseEnter(screen.getByTestId("activity-row-root"));
    const qa = screen.getByTestId("activity-row-quick-actions");
    expect(() => fireEvent.click(within(qa).getByTestId("activity-row-quick-copy"))).not.toThrow();
    expect(onToggleExpand).not.toHaveBeenCalled();
  });
});
