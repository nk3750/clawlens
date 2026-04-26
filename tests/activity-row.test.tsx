// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ActivityRow from "../dashboard/src/components/activity/ActivityRow";
import type { ActivityCategory, EntryResponse } from "../dashboard/src/lib/types";

const NOW = new Date("2026-04-26T18:00:00.000Z").getTime();

function entry(overrides: Partial<EntryResponse> = {}): EntryResponse {
  return {
    timestamp: new Date(NOW - 30 * 1000).toISOString(),
    toolName: "exec",
    toolCallId: "tc_1",
    params: { command: "ls -la /tmp" },
    effectiveDecision: "allow",
    category: "scripts" as ActivityCategory,
    agentId: "baddie",
    riskTier: "high",
    riskScore: 60,
    riskTags: ["destructive"],
    ...overrides,
  };
}

describe("ActivityRow — rendering", () => {
  it("renders the agent chip, decision text, tier badge, and rel-time", () => {
    render(<ActivityRow entry={entry()} isNew={false} onChip={vi.fn()} />);
    expect(screen.getByTestId("activity-row-agent-chip")).toHaveTextContent("baddie");
    expect(screen.getByTestId("activity-row-tier-badge")).toBeInTheDocument();
    expect(screen.getByTestId("activity-row-time")).toBeInTheDocument();
  });

  it("renders the avatar and category icon", () => {
    const { container } = render(<ActivityRow entry={entry()} isNew={false} onChip={vi.fn()} />);
    // Avatar uses GradientAvatar (rounded-full div).
    expect(container.querySelector("[data-testid='activity-row-avatar']")).toBeInTheDocument();
    expect(container.querySelector("[data-testid='activity-row-cat-icon']")).toBeInTheDocument();
  });

  it("renders inline tags (max 2) using deriveTags", () => {
    const tagged = entry({ riskTags: ["destructive", "secret"], effectiveDecision: "allow" });
    render(<ActivityRow entry={tagged} isNew={false} onChip={vi.fn()} />);
    const tags = screen.getAllByTestId(/^activity-row-tag-/);
    expect(tags.length).toBeLessThanOrEqual(2);
  });

  it("shows decision pill for non-allow decisions", () => {
    render(
      <ActivityRow entry={entry({ effectiveDecision: "block" })} isNew={false} onChip={vi.fn()} />,
    );
    expect(screen.getByTestId("activity-row-decision")).toBeInTheDocument();
  });

  it("hides decision pill for allow", () => {
    render(<ActivityRow entry={entry()} isNew={false} onChip={vi.fn()} />);
    expect(screen.queryByTestId("activity-row-decision")).toBeNull();
  });
});

describe("ActivityRow — chip interactions", () => {
  it("clicking the agent chip calls onChip('agent', entry.agentId)", () => {
    const onChip = vi.fn();
    render(<ActivityRow entry={entry()} isNew={false} onChip={onChip} />);
    fireEvent.click(screen.getByTestId("activity-row-agent-chip"));
    expect(onChip).toHaveBeenCalledWith("agent", "baddie");
  });

  it("clicking the tier badge calls onChip('tier', tier)", () => {
    const onChip = vi.fn();
    render(<ActivityRow entry={entry()} isNew={false} onChip={onChip} />);
    fireEvent.click(screen.getByTestId("activity-row-tier-badge"));
    expect(onChip).toHaveBeenCalledWith("tier", "high");
  });
});

describe("ActivityRow — tier-color left border", () => {
  it("medium tier renders an inset 2px box-shadow in the medium color", () => {
    const { container } = render(
      <ActivityRow
        entry={entry({ riskTier: "medium", riskScore: 35 })}
        isNew={false}
        onChip={vi.fn()}
      />,
    );
    const root = container.querySelector("[data-testid='activity-row-root']") as HTMLElement;
    expect(root.style.boxShadow).toContain("inset 2px 0 0 0");
  });

  it("high tier renders an inset 2px box-shadow", () => {
    const { container } = render(
      <ActivityRow
        entry={entry({ riskTier: "high", riskScore: 60 })}
        isNew={false}
        onChip={vi.fn()}
      />,
    );
    const root = container.querySelector("[data-testid='activity-row-root']") as HTMLElement;
    expect(root.style.boxShadow).toContain("inset 2px 0 0 0");
  });

  it("critical tier renders an inset 2px box-shadow", () => {
    const { container } = render(
      <ActivityRow
        entry={entry({ riskTier: "critical", riskScore: 90 })}
        isNew={false}
        onChip={vi.fn()}
      />,
    );
    const root = container.querySelector("[data-testid='activity-row-root']") as HTMLElement;
    expect(root.style.boxShadow).toContain("inset 2px 0 0 0");
  });

  it("low tier renders no left border", () => {
    const { container } = render(
      <ActivityRow
        entry={entry({ riskTier: "low", riskScore: 10 })}
        isNew={false}
        onChip={vi.fn()}
      />,
    );
    const root = container.querySelector("[data-testid='activity-row-root']") as HTMLElement;
    expect(root.style.boxShadow).toBe("");
  });

  it("entry with undefined riskTier renders no left border AND no tier badge (post-#33)", () => {
    const { container } = render(
      <ActivityRow
        entry={entry({ riskTier: undefined, riskScore: undefined })}
        isNew={false}
        onChip={vi.fn()}
      />,
    );
    const root = container.querySelector("[data-testid='activity-row-root']") as HTMLElement;
    expect(root.style.boxShadow).toBe("");
    expect(screen.queryByTestId("activity-row-tier-badge")).toBeNull();
  });
});

describe("ActivityRow — SSE animation gating", () => {
  it("isNew=true applies the row-flash + row-slide animations", () => {
    const { container } = render(<ActivityRow entry={entry()} isNew onChip={vi.fn()} />);
    const root = container.querySelector("[data-testid='activity-row-root']") as HTMLElement;
    expect(root.style.animation).toContain("row-slide");
    expect(root.style.animation).toContain("row-flash");
  });

  it("isNew=false applies no animation", () => {
    const { container } = render(<ActivityRow entry={entry()} isNew={false} onChip={vi.fn()} />);
    const root = container.querySelector("[data-testid='activity-row-root']") as HTMLElement;
    expect(root.style.animation).toBe("");
  });
});
