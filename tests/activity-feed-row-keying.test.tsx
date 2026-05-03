// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import ActivityFeed from "../dashboard/src/components/activity/ActivityFeed";
import type { ActivityCategory, EntryResponse } from "../dashboard/src/lib/types";

/**
 * Synthetic edge case: two rows in the same hour group sharing the same
 * `entry.toolCallId || entry.timestamp` value. Defense-in-depth coverage
 * for #50 — even after the SSE stream filter (commit 1) drops follow-up
 * eval/result rows, two decision rows can still collide if the gateway
 * reuses a toolCallId. The expand-state must key by row position so a
 * click on row 0 expands ONLY row 0.
 */
function entry(overrides: Partial<EntryResponse> = {}): EntryResponse {
  return {
    timestamp: "2026-04-26T17:00:00.000Z",
    toolName: "exec",
    toolCallId: "tc_collide",
    params: { command: "ls" },
    effectiveDecision: "allow",
    category: "scripts" as ActivityCategory,
    agentId: "alpha",
    riskTier: "low",
    riskScore: 10,
    ...overrides,
  };
}

function renderFeed(entries: EntryResponse[]) {
  return render(
    <MemoryRouter initialEntries={["/activity"]}>
      <ActivityFeed
        filters={{}}
        entries={entries}
        totalCount={entries.length}
        totalCountAtCap={false}
        newIds={new Set()}
        paused={false}
        hasMore={false}
        loadingMore={false}
        onTogglePause={vi.fn()}
        onClear={vi.fn()}
        onClearAll={vi.fn()}
        onChip={vi.fn()}
        onLoadMore={vi.fn()}
        onSetQ={vi.fn()}
        isMobile={false}
        isCompact={false}
        isNarrow={false}
      />
    </MemoryRouter>,
  );
}

describe("ActivityFeed — row expand state keyed by index", () => {
  it("clicking the first row when two rows share toolCallId expands only the first", () => {
    const a = entry({ toolCallId: "tc_dup", params: { command: "echo a" } });
    const b = entry({ toolCallId: "tc_dup", params: { command: "echo b" } });
    renderFeed([a, b]);

    const roots = screen.getAllByTestId("activity-row-root");
    expect(roots.length).toBe(2);

    fireEvent.click(roots[0]);
    expect(roots[0].getAttribute("aria-expanded")).toBe("true");
    expect(roots[1].getAttribute("aria-expanded")).toBe("false");
    expect(screen.getAllByTestId("activity-row-expanded").length).toBe(1);
  });

  it("clicking the second row when two rows share toolCallId expands only the second", () => {
    const a = entry({ toolCallId: "tc_dup", params: { command: "echo a" } });
    const b = entry({ toolCallId: "tc_dup", params: { command: "echo b" } });
    renderFeed([a, b]);

    const roots = screen.getAllByTestId("activity-row-root");
    fireEvent.click(roots[1]);
    expect(roots[0].getAttribute("aria-expanded")).toBe("false");
    expect(roots[1].getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByTestId("activity-row-expanded").length).toBe(1);
  });

  it("clicking row 0 then row 1 collapses row 0 and expands row 1", () => {
    const a = entry({ toolCallId: "tc_dup", params: { command: "echo a" } });
    const b = entry({ toolCallId: "tc_dup", params: { command: "echo b" } });
    renderFeed([a, b]);

    const roots = screen.getAllByTestId("activity-row-root");
    fireEvent.click(roots[0]);
    fireEvent.click(roots[1]);
    expect(roots[0].getAttribute("aria-expanded")).toBe("false");
    expect(roots[1].getAttribute("aria-expanded")).toBe("true");
  });

  it("rows with distinct toolCallIds still toggle independently (regression)", () => {
    const a = entry({ toolCallId: "tc_a", params: { command: "echo a" } });
    const b = entry({ toolCallId: "tc_b", params: { command: "echo b" } });
    renderFeed([a, b]);

    const roots = screen.getAllByTestId("activity-row-root");
    fireEvent.click(roots[0]);
    expect(roots[0].getAttribute("aria-expanded")).toBe("true");
    expect(roots[1].getAttribute("aria-expanded")).toBe("false");
  });
});
