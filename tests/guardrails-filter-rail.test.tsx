// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import GuardrailFilterRail from "../dashboard/src/components/guardrails/GuardrailFilterRail";
import type { Filters } from "../dashboard/src/components/guardrails/shared";

const counts = {
  agent: { alpha: 2, beta: 1, global: 3 } as Record<string, number>,
  action: { block: 4, require_approval: 1, allow_notify: 1 } as Record<
    "block" | "require_approval" | "allow_notify",
    number
  >,
  kind: { file: 2, exec: 2, url: 1, advanced: 1 } as Record<
    "file" | "exec" | "url" | "advanced",
    number
  >,
  tier: { critical: 1, high: 2, medium: 2, low: 1 } as Record<
    "low" | "medium" | "high" | "critical",
    number
  >,
};

describe("GuardrailFilterRail", () => {
  it("renders the four filter group labels + a decorative search input", () => {
    render(<GuardrailFilterRail filters={{}} setFilters={vi.fn()} counts={counts} />);
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
    expect(screen.getByText("agent")).toBeInTheDocument();
    expect(screen.getByText("action")).toBeInTheDocument();
    expect(screen.getByText("resource")).toBeInTheDocument();
    expect(screen.getByText("risk")).toBeInTheDocument();
  });

  it("renders option counts next to labels", () => {
    render(<GuardrailFilterRail filters={{}} setFilters={vi.fn()} counts={counts} />);
    // block count = 4 — appears next to the "block" label
    expect(screen.getByTestId("count-action-block").textContent).toBe("4");
    expect(screen.getByTestId("count-tier-critical").textContent).toBe("1");
  });

  it("clicking an action option sets that filter", () => {
    const setFilters = vi.fn<(f: Filters) => void>();
    render(<GuardrailFilterRail filters={{}} setFilters={setFilters} counts={counts} />);
    fireEvent.click(screen.getByTestId("opt-action-block"));
    const arg = setFilters.mock.calls[0][0];
    expect(arg.action).toBe("block");
  });

  it("clicking the currently-active action option toggles it off", () => {
    const setFilters = vi.fn<(f: Filters) => void>();
    render(
      <GuardrailFilterRail filters={{ action: "block" }} setFilters={setFilters} counts={counts} />,
    );
    fireEvent.click(screen.getByTestId("opt-action-block"));
    const arg = setFilters.mock.calls[0][0];
    expect(arg.action).toBeUndefined();
  });

  it("group-header clear-button removes only that group's filter", () => {
    const setFilters = vi.fn<(f: Filters) => void>();
    render(
      <GuardrailFilterRail
        filters={{ action: "block", kind: "file" }}
        setFilters={setFilters}
        counts={counts}
      />,
    );
    fireEvent.click(screen.getByTestId("clear-action"));
    const arg = setFilters.mock.calls[0][0];
    expect(arg.action).toBeUndefined();
    expect(arg.kind).toBe("file");
  });

  it("decorative search input does NOT call setFilters when typed in (per §5.4)", () => {
    const setFilters = vi.fn();
    render(<GuardrailFilterRail filters={{}} setFilters={setFilters} counts={counts} />);
    const input = screen.getByPlaceholderText(/search/i);
    fireEvent.change(input, { target: { value: "hello" } });
    expect(setFilters).not.toHaveBeenCalled();
  });

  it("clicking 'all agents' sets the agent filter to 'global'", () => {
    const setFilters = vi.fn<(f: Filters) => void>();
    render(<GuardrailFilterRail filters={{}} setFilters={setFilters} counts={counts} />);
    fireEvent.click(screen.getByTestId("opt-agent-global"));
    const arg = setFilters.mock.calls[0][0];
    expect(arg.agent).toBe("global");
  });

  it("clicking a specific agent sets the agent filter to that id", () => {
    const setFilters = vi.fn<(f: Filters) => void>();
    render(<GuardrailFilterRail filters={{}} setFilters={setFilters} counts={counts} />);
    fireEvent.click(screen.getByTestId("opt-agent-alpha"));
    const arg = setFilters.mock.calls[0][0];
    expect(arg.agent).toBe("alpha");
  });
});
