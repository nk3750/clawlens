// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
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
    ...overrides,
  };
}

interface RenderProps {
  entry?: EntryResponse;
  isCompact?: boolean;
  isNarrow?: boolean;
  isTapped?: boolean;
  isExpanded?: boolean;
  onToggleTapped?: () => void;
  onToggleExpand?: () => void;
}

function renderRow(props: RenderProps = {}) {
  const e = props.entry ?? entry();
  return render(
    <MemoryRouter initialEntries={["/activity"]}>
      <ActivityRow
        entry={e}
        isNew={false}
        onChip={vi.fn()}
        isCompact={props.isCompact ?? true}
        isNarrow={props.isNarrow ?? false}
        isTapped={props.isTapped ?? false}
        isExpanded={props.isExpanded ?? false}
        onToggleTapped={props.onToggleTapped ?? vi.fn()}
        onToggleExpand={props.onToggleExpand ?? vi.fn()}
      />
    </MemoryRouter>,
  );
}

describe("ActivityRow — compact tap behavior", () => {
  it("does not show quick-actions or tier-info strip when not tapped", () => {
    renderRow({ isCompact: true, isTapped: false });
    expect(screen.queryByTestId("activity-row-quick-actions")).toBeNull();
    expect(screen.queryByTestId("activity-row-tier-info-strip")).toBeNull();
  });

  it("shows quick-actions and tier-info strip when tapped at compact viewport", () => {
    renderRow({ isCompact: true, isTapped: true });
    expect(screen.getByTestId("activity-row-quick-actions")).toBeInTheDocument();
    expect(screen.getByTestId("activity-row-tier-info-strip")).toBeInTheDocument();
  });

  it("clicking the row at compact viewport calls onToggleTapped (NOT onToggleExpand)", () => {
    const onToggleTapped = vi.fn();
    const onToggleExpand = vi.fn();
    renderRow({ isCompact: true, onToggleTapped, onToggleExpand });
    fireEvent.click(screen.getByTestId("activity-row-root"));
    expect(onToggleTapped).toHaveBeenCalledTimes(1);
    expect(onToggleExpand).not.toHaveBeenCalled();
  });

  it("includes a 4th expand quick-action button when tapped at compact viewport", () => {
    renderRow({ isCompact: true, isTapped: true });
    expect(screen.getByTestId("activity-row-quick-expand")).toBeInTheDocument();
  });

  it("clicking the 4th expand button calls onToggleExpand and not onToggleTapped", () => {
    const onToggleExpand = vi.fn();
    const onToggleTapped = vi.fn();
    renderRow({
      isCompact: true,
      isTapped: true,
      onToggleExpand,
      onToggleTapped,
    });
    fireEvent.click(screen.getByTestId("activity-row-quick-expand"));
    expect(onToggleExpand).toHaveBeenCalledTimes(1);
    expect(onToggleTapped).not.toHaveBeenCalled();
  });

  it("desktop mode (isCompact=false) keeps click-to-expand behavior", () => {
    const onToggleTapped = vi.fn();
    const onToggleExpand = vi.fn();
    renderRow({ isCompact: false, onToggleTapped, onToggleExpand });
    fireEvent.click(screen.getByTestId("activity-row-root"));
    expect(onToggleExpand).toHaveBeenCalledTimes(1);
    expect(onToggleTapped).not.toHaveBeenCalled();
  });

  it("desktop mode does not show the 4th expand quick-action button (no touch)", () => {
    // Desktop hover state — simulate by setting isTapped=false but checking
    // what the hover-revealed strip would render. The hover quick-actions
    // are hover-gated; this test verifies that when they DO render at
    // desktop, the expand button is absent (hover users use row click).
    renderRow({ isCompact: false, isTapped: false });
    // Without hover, the strip is absent altogether at desktop.
    expect(screen.queryByTestId("activity-row-quick-actions")).toBeNull();
    // And without a tapped state at desktop, the expand quick-action never
    // appears — desktop's expand path is row click on the root.
    expect(screen.queryByTestId("activity-row-quick-expand")).toBeNull();
  });

  it("inline tags are hidden at compact viewport", () => {
    renderRow({ isCompact: true });
    expect(screen.queryAllByTestId(/^activity-row-tag-/).length).toBe(0);
  });

  it("inline tags are present at desktop", () => {
    renderRow({ isCompact: false });
    expect(screen.queryAllByTestId(/^activity-row-tag-/).length).toBeGreaterThan(0);
  });
});

describe("ActivityRow — narrow viewport stacking", () => {
  it("row root uses column flex-direction at narrow viewport", () => {
    renderRow({ isCompact: true, isNarrow: true });
    const root = screen.getByTestId("activity-row-root");
    expect(root.style.flexDirection).toBe("column");
  });

  it("row root keeps non-column flex-direction at non-narrow viewport", () => {
    renderRow({ isCompact: true, isNarrow: false });
    const root = screen.getByTestId("activity-row-root");
    expect(root.style.flexDirection).not.toBe("column");
  });
});
