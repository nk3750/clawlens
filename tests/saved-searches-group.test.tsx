// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SavedSearchesGroup from "../dashboard/src/components/activity/SavedSearchesGroup";
import type { Filters } from "../dashboard/src/lib/activityFilters";
import { addSaved, loadSaved, STORAGE_KEY } from "../dashboard/src/lib/savedSearches";
import type { ActivityCategory, EntryResponse } from "../dashboard/src/lib/types";

// Realistic basis — mirrors the rail's count-basis fetch (24h, capped at 200).
const NOW = new Date("2026-04-26T18:00:00.000Z").getTime();

function entry(overrides: Partial<EntryResponse>): EntryResponse {
  return {
    timestamp: new Date(NOW - 30 * 60_000).toISOString(),
    toolName: "exec",
    params: {},
    effectiveDecision: "allow",
    category: "scripts" as ActivityCategory,
    ...overrides,
  };
}

const COUNT_BASIS: EntryResponse[] = [
  entry({ toolCallId: "1", agentId: "baddie", riskTier: "critical", effectiveDecision: "block" }),
  entry({ toolCallId: "2", agentId: "baddie", riskTier: "high", effectiveDecision: "allow" }),
  entry({ toolCallId: "3", agentId: "seo-growth", riskTier: "low", effectiveDecision: "allow" }),
];

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

interface SetupOptions {
  filters?: Filters;
  countBasis?: EntryResponse[];
}

function setup(opts: SetupOptions = {}) {
  const onApplyFilters = vi.fn();
  const utils = render(
    <SavedSearchesGroup
      filters={opts.filters ?? {}}
      countBasis={opts.countBasis ?? COUNT_BASIS}
      onApplyFilters={onApplyFilters}
    />,
  );
  return { ...utils, onApplyFilters };
}

describe("SavedSearchesGroup — empty state", () => {
  it("renders the saved group with no rows when localStorage is empty", () => {
    setup();
    expect(screen.getByTestId("filter-group-saved")).toBeInTheDocument();
    // No saved rows under the group.
    expect(screen.queryAllByTestId(/^saved-row-/)).toHaveLength(0);
  });
});

describe("SavedSearchesGroup — + button enable/disable", () => {
  it("+ button is disabled when activeFilterCount(filters) === 0", () => {
    setup({ filters: {} });
    const btn = screen.getByTestId("saved-add-btn") as HTMLButtonElement;
    expect(btn).toBeDisabled();
  });

  it("+ button is enabled when ≥1 filter is active", () => {
    setup({ filters: { tier: "high" } });
    const btn = screen.getByTestId("saved-add-btn") as HTMLButtonElement;
    expect(btn).not.toBeDisabled();
  });
});

describe("SavedSearchesGroup — inline-input save flow", () => {
  it("clicking + reveals the inline input", () => {
    setup({ filters: { tier: "high" } });
    expect(screen.queryByTestId("saved-name-input")).toBeNull();
    fireEvent.click(screen.getByTestId("saved-add-btn"));
    expect(screen.getByTestId("saved-name-input")).toBeInTheDocument();
  });

  it("typing a name and pressing Enter saves and the row appears", () => {
    setup({ filters: { tier: "high" } });
    fireEvent.click(screen.getByTestId("saved-add-btn"));
    const input = screen.getByTestId("saved-name-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "high stuff" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // Row appears.
    const rows = screen.queryAllByTestId(/^saved-row-/).filter((el) => {
      const id = el.getAttribute("data-testid") ?? "";
      return !id.endsWith("-remove");
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("high stuff");

    // Persisted to localStorage with the v:1 envelope.
    const items = loadSaved();
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("high stuff");
    expect(items[0].filters).toEqual({ tier: "high" });

    // Input closes after save.
    expect(screen.queryByTestId("saved-name-input")).toBeNull();
  });

  it("pressing Enter with empty/whitespace name closes input without saving", () => {
    setup({ filters: { tier: "high" } });
    fireEvent.click(screen.getByTestId("saved-add-btn"));
    const input = screen.getByTestId("saved-name-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(loadSaved()).toEqual([]);
    expect(screen.queryByTestId("saved-name-input")).toBeNull();
  });

  it("pressing Escape cancels the input without saving", () => {
    setup({ filters: { tier: "high" } });
    fireEvent.click(screen.getByTestId("saved-add-btn"));
    const input = screen.getByTestId("saved-name-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "abandoned" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(loadSaved()).toEqual([]);
    expect(screen.queryByTestId("saved-name-input")).toBeNull();
  });
});

describe("SavedSearchesGroup — saved row rendering", () => {
  it("each saved row renders the green-dot indicator + name + count + × button", () => {
    addSaved("baddie blocks", { agent: "baddie", decision: "block" });
    setup();
    const rows = screen.queryAllByTestId(/^saved-row-/).filter((el) => {
      const id = el.getAttribute("data-testid") ?? "";
      return !id.endsWith("-remove");
    });
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.textContent).toContain("baddie blocks");
    // Count under filters {agent: 'baddie', decision: 'block'} → 1 (toolCallId "1").
    expect(row.textContent).toContain("1");

    // Green dot present (uses var(--cl-risk-low) — assert via testid +
    // inline-style substring; jsdom doesn't normalize `var()` consistently
    // through the style.background property accessor).
    const dot = row.querySelector('[data-testid="saved-dot"]') as HTMLElement | null;
    expect(dot).not.toBeNull();
    expect(dot?.getAttribute("style") ?? "").toContain("var(--cl-risk-low)");

    // × button present + accessible.
    const removeBtn = screen.getByTestId(`saved-row-${loadSaved()[0].id}-remove`);
    expect(removeBtn).toHaveAttribute("aria-label");
  });
});

describe("SavedSearchesGroup — apply on click", () => {
  it("clicking a saved row fires onApplyFilters(savedItem.filters) exactly", () => {
    addSaved("crit only", { tier: "critical" });
    const { onApplyFilters } = setup();
    const id = loadSaved()[0].id;
    fireEvent.click(screen.getByTestId(`saved-row-${id}`));
    expect(onApplyFilters).toHaveBeenCalledTimes(1);
    expect(onApplyFilters).toHaveBeenCalledWith({ tier: "critical" });
  });

  it("clicking × does NOT fire onApplyFilters (event isolated)", () => {
    addSaved("crit only", { tier: "critical" });
    const { onApplyFilters } = setup();
    const id = loadSaved()[0].id;
    fireEvent.click(screen.getByTestId(`saved-row-${id}-remove`));
    expect(onApplyFilters).not.toHaveBeenCalled();
  });
});

describe("SavedSearchesGroup — delete row", () => {
  it("clicking × removes the row from UI and localStorage", () => {
    const a = addSaved("a", { tier: "high" });
    addSaved("b", { tier: "low" });
    setup();
    fireEvent.click(screen.getByTestId(`saved-row-${a!.id}-remove`));

    // UI: only the surviving row remains.
    const rows = screen.queryAllByTestId(/^saved-row-/).filter((el) => {
      const id = el.getAttribute("data-testid") ?? "";
      return !id.endsWith("-remove");
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("b");

    // Storage: same — a is gone, b remains.
    const items = loadSaved();
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("b");
  });
});

describe("SavedSearchesGroup — live counts", () => {
  it("count reflects matches against current countBasis", () => {
    addSaved("crit", { tier: "critical" });
    setup();
    const id = loadSaved()[0].id;
    const row = screen.getByTestId(`saved-row-${id}`);
    // 1 critical entry in COUNT_BASIS.
    expect(row.textContent).toContain("1");
  });

  it("count updates when countBasis prop changes (SSE-driven re-render)", () => {
    addSaved("high", { tier: "high" });
    const filters: Filters = {};
    const { rerender } = render(
      <SavedSearchesGroup filters={filters} countBasis={COUNT_BASIS} onApplyFilters={vi.fn()} />,
    );
    const id = loadSaved()[0].id;
    // Initially 1 high in COUNT_BASIS.
    expect(screen.getByTestId(`saved-row-${id}`).textContent).toContain("1");

    // Add two more high entries via re-render.
    const wider: EntryResponse[] = [
      ...COUNT_BASIS,
      entry({ toolCallId: "x", agentId: "baddie", riskTier: "high" }),
      entry({ toolCallId: "y", agentId: "seo-growth", riskTier: "high" }),
    ];
    rerender(<SavedSearchesGroup filters={filters} countBasis={wider} onApplyFilters={vi.fn()} />);
    expect(screen.getByTestId(`saved-row-${id}`).textContent).toContain("3");
  });
});

describe("SavedSearchesGroup — storage stub failure modes", () => {
  it("renders empty when getItem throws (storage disabled)", () => {
    const orig = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error("storage disabled");
    };
    try {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      setup();
      expect(screen.queryAllByTestId(/^saved-row-/)).toHaveLength(0);
      warn.mockRestore();
    } finally {
      Storage.prototype.getItem = orig;
    }
  });

  it("does not crash when setItem throws on save (quota exceeded)", () => {
    const origSet = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("quota exceeded");
    };
    try {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      setup({ filters: { tier: "high" } });
      fireEvent.click(screen.getByTestId("saved-add-btn"));
      const input = screen.getByTestId("saved-name-input") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "abc" } });
      // Must not throw.
      fireEvent.keyDown(input, { key: "Enter" });
      // Row not added (write failed).
      expect(screen.queryAllByTestId(/^saved-row-/)).toHaveLength(0);
      warn.mockRestore();
    } finally {
      Storage.prototype.setItem = origSet;
    }
  });
});

// Round-trip sanity: the persisted blob round-trips through loadSaved and
// matches what the next page-load would render. Locks the schema for 2.8.
describe("SavedSearchesGroup — schema round-trip", () => {
  it("persisted entries round-trip via STORAGE_KEY envelope", () => {
    setup({ filters: { tier: "high", agent: "baddie" } });
    fireEvent.click(screen.getByTestId("saved-add-btn"));
    const input = screen.getByTestId("saved-name-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "rt" } });
    fireEvent.keyDown(input, { key: "Enter" });

    const raw = localStorage.getItem(STORAGE_KEY)!;
    const parsed = JSON.parse(raw);
    expect(parsed.v).toBe(1);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].name).toBe("rt");
    expect(parsed.items[0].filters).toEqual({ tier: "high", agent: "baddie" });
  });
});
