// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SavedSearchesGroup from "../dashboard/src/components/activity/SavedSearchesGroup";
import type { Filters } from "../dashboard/src/lib/activityFilters";
import {
  MIGRATION_FLAG_KEY,
  type SavedSearch,
  STORAGE_KEY,
} from "../dashboard/src/lib/savedSearches";
import type { ActivityCategory, EntryResponse } from "../dashboard/src/lib/types";

// Phase 2.8 (#36): UI state now sources from the backend via
// useSavedSearches → useApi(GET /api/saved-searches). Tests mock fetch to
// return a controlled "items" list and verify the component renders/mutates
// against it. Migration runs once per mount; we set the migrated flag in
// beforeEach so most tests skip migration entirely. The migration-on-mount
// test toggles it off and seeds localStorage to exercise that path.

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

interface FetchState {
  items: SavedSearch[];
  /** Per-method override hook. Returning a Response triggers a non-200 path. */
  override?: (method: string, url: string, body: unknown) => Response | null;
}

let fetchState: FetchState;
let fetchMock: ReturnType<typeof vi.fn>;

function makeItem(name: string, filters: Filters): SavedSearch {
  return {
    id: `ss_${name.replace(/\s+/g, "_")}`,
    name,
    filters,
    createdAt: "2026-04-26T10:00:00.000Z",
  };
}

function buildResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    // biome-ignore lint/suspicious/noExplicitAny: Response shim for the few fields the hook reads
  } as any;
}

beforeEach(() => {
  localStorage.clear();
  // Skip migration in most tests — the migration-on-mount test re-enables.
  localStorage.setItem(MIGRATION_FLAG_KEY, "1");

  fetchState = { items: [] };
  fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = typeof input === "string" ? input : "";
    const method = init?.method ?? "GET";

    if (fetchState.override) {
      const body = init?.body ? JSON.parse(init.body as string) : null;
      const overridden = fetchState.override(method, url, body);
      if (overridden) return overridden;
    }

    if (url.endsWith("/api/saved-searches") && method === "GET") {
      return buildResponse({ items: fetchState.items });
    }
    if (url.endsWith("/api/saved-searches") && method === "POST") {
      const body = JSON.parse(init?.body as string) as { name: string; filters: Filters };
      const item = makeItem(body.name, body.filters);
      fetchState.items = [...fetchState.items, item];
      return buildResponse({ item });
    }
    const delMatch = url.match(/\/api\/saved-searches\/([^/]+)$/);
    if (delMatch && method === "DELETE") {
      const id = decodeURIComponent(delMatch[1]);
      const before = fetchState.items.length;
      fetchState.items = fetchState.items.filter((s) => s.id !== id);
      if (fetchState.items.length === before) return buildResponse({ error: "not found" }, 404);
      return buildResponse({ ok: true });
    }
    return buildResponse({}, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

interface SetupOptions {
  filters?: Filters;
  countBasis?: EntryResponse[];
  initialItems?: SavedSearch[];
}

function setup(opts: SetupOptions = {}) {
  if (opts.initialItems) fetchState.items = opts.initialItems;
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

async function awaitFirstFetch() {
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
}

describe("SavedSearchesGroup — empty state", () => {
  it("renders the saved group with no rows when the backend returns an empty list", async () => {
    setup();
    await awaitFirstFetch();
    expect(screen.getByTestId("filter-group-saved")).toBeInTheDocument();
    expect(screen.queryAllByTestId(/^saved-row-/)).toHaveLength(0);
  });
});

describe("SavedSearchesGroup — + button enable/disable", () => {
  it("+ button is disabled when activeFilterCount(filters) === 0", async () => {
    setup({ filters: {} });
    await awaitFirstFetch();
    const btn = screen.getByTestId("saved-add-btn") as HTMLButtonElement;
    expect(btn).toBeDisabled();
  });

  it("+ button is enabled when ≥1 filter is active", async () => {
    setup({ filters: { tier: "high" } });
    await awaitFirstFetch();
    const btn = screen.getByTestId("saved-add-btn") as HTMLButtonElement;
    expect(btn).not.toBeDisabled();
  });
});

describe("SavedSearchesGroup — inline-input save flow", () => {
  it("clicking + reveals the inline input", async () => {
    setup({ filters: { tier: "high" } });
    await awaitFirstFetch();
    expect(screen.queryByTestId("saved-name-input")).toBeNull();
    fireEvent.click(screen.getByTestId("saved-add-btn"));
    expect(screen.getByTestId("saved-name-input")).toBeInTheDocument();
  });

  it("typing a name and pressing Enter POSTs to the backend and the row appears", async () => {
    setup({ filters: { tier: "high" } });
    await awaitFirstFetch();
    fireEvent.click(screen.getByTestId("saved-add-btn"));
    const input = screen.getByTestId("saved-name-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "high stuff" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // Wait for the POST + refetch to settle.
    await waitFor(() => {
      const rows = screen.queryAllByTestId(/^saved-row-/).filter((el) => {
        const id = el.getAttribute("data-testid") ?? "";
        return !id.endsWith("-remove");
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].textContent).toContain("high stuff");
    });

    // Backend received the POST with the right body.
    const post = fetchMock.mock.calls.find(
      (c) => (c[1] as RequestInit | undefined)?.method === "POST",
    );
    expect(post).toBeDefined();
    const body = JSON.parse((post?.[1] as RequestInit).body as string);
    expect(body).toEqual({ name: "high stuff", filters: { tier: "high" } });

    // Input closes after save.
    expect(screen.queryByTestId("saved-name-input")).toBeNull();
  });

  it("pressing Enter with empty/whitespace name closes input without POSTing", async () => {
    setup({ filters: { tier: "high" } });
    await awaitFirstFetch();
    fetchMock.mockClear();

    fireEvent.click(screen.getByTestId("saved-add-btn"));
    const input = screen.getByTestId("saved-name-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(screen.queryByTestId("saved-name-input")).toBeNull();
    });

    // No POST was issued.
    const post = fetchMock.mock.calls.find(
      (c) => (c[1] as RequestInit | undefined)?.method === "POST",
    );
    expect(post).toBeUndefined();
  });

  it("pressing Escape cancels the input without POSTing", async () => {
    setup({ filters: { tier: "high" } });
    await awaitFirstFetch();
    fetchMock.mockClear();

    fireEvent.click(screen.getByTestId("saved-add-btn"));
    const input = screen.getByTestId("saved-name-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "abandoned" } });
    fireEvent.keyDown(input, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByTestId("saved-name-input")).toBeNull();
    });

    const post = fetchMock.mock.calls.find(
      (c) => (c[1] as RequestInit | undefined)?.method === "POST",
    );
    expect(post).toBeUndefined();
  });
});

describe("SavedSearchesGroup — saved row rendering", () => {
  it("each saved row renders the green-dot indicator + name + count + × button", async () => {
    const seeded = makeItem("baddie blocks", { agent: "baddie", decision: "block" });
    setup({ initialItems: [seeded] });
    await awaitFirstFetch();
    await waitFor(() => {
      expect(screen.getAllByTestId(/^saved-row-/).length).toBeGreaterThan(0);
    });

    const rows = screen.queryAllByTestId(/^saved-row-/).filter((el) => {
      const id = el.getAttribute("data-testid") ?? "";
      return !id.endsWith("-remove");
    });
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.textContent).toContain("baddie blocks");
    // Count under filters {agent: 'baddie', decision: 'block'} → 1.
    expect(row.textContent).toContain("1");

    const dot = row.querySelector('[data-testid="saved-dot"]') as HTMLElement | null;
    expect(dot).not.toBeNull();
    expect(dot?.getAttribute("style") ?? "").toContain("var(--cl-risk-low)");

    const removeBtn = screen.getByTestId(`saved-row-${seeded.id}-remove`);
    expect(removeBtn).toHaveAttribute("aria-label");
  });
});

describe("SavedSearchesGroup — apply on click", () => {
  it("clicking a saved row fires onApplyFilters(savedItem.filters) exactly", async () => {
    const seeded = makeItem("crit only", { tier: "critical" });
    const { onApplyFilters } = setup({ initialItems: [seeded] });
    await awaitFirstFetch();
    await waitFor(() => {
      expect(screen.queryByTestId(`saved-row-${seeded.id}`)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId(`saved-row-${seeded.id}`));
    expect(onApplyFilters).toHaveBeenCalledTimes(1);
    expect(onApplyFilters).toHaveBeenCalledWith({ tier: "critical" });
  });

  it("clicking × does NOT fire onApplyFilters (event isolated)", async () => {
    const seeded = makeItem("crit only", { tier: "critical" });
    const { onApplyFilters } = setup({ initialItems: [seeded] });
    await awaitFirstFetch();
    await waitFor(() => {
      expect(screen.queryByTestId(`saved-row-${seeded.id}-remove`)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId(`saved-row-${seeded.id}-remove`));
    expect(onApplyFilters).not.toHaveBeenCalled();
  });
});

describe("SavedSearchesGroup — delete row", () => {
  it("clicking × DELETEs to the backend and removes the row from UI", async () => {
    const a = makeItem("a", { tier: "high" });
    const b = makeItem("b", { tier: "low" });
    setup({ initialItems: [a, b] });
    await awaitFirstFetch();
    await waitFor(() => {
      expect(screen.queryByTestId(`saved-row-${a.id}-remove`)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(`saved-row-${a.id}-remove`));

    await waitFor(() => {
      const rows = screen.queryAllByTestId(/^saved-row-/).filter((el) => {
        const id = el.getAttribute("data-testid") ?? "";
        return !id.endsWith("-remove");
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].textContent).toContain("b");
    });

    // Backend received the DELETE.
    const del = fetchMock.mock.calls.find(
      (c) => (c[1] as RequestInit | undefined)?.method === "DELETE",
    );
    expect(del).toBeDefined();
    expect(typeof del?.[0]).toBe("string");
    expect(String(del?.[0])).toContain(`/api/saved-searches/${a.id}`);
  });
});

describe("SavedSearchesGroup — live counts", () => {
  it("count reflects matches against current countBasis", async () => {
    const seeded = makeItem("crit", { tier: "critical" });
    setup({ initialItems: [seeded] });
    await awaitFirstFetch();
    await waitFor(() => {
      const row = screen.queryByTestId(`saved-row-${seeded.id}`);
      expect(row).not.toBeNull();
      expect(row?.textContent).toContain("1");
    });
  });
});

describe("SavedSearchesGroup — failure modes", () => {
  it("a 5xx POST does not add a row (silent fail — no toast for this phase)", async () => {
    fetchState.override = (method) =>
      method === "POST" ? buildResponse({ error: "x" }, 500) : null;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    setup({ filters: { tier: "high" } });
    await awaitFirstFetch();

    fireEvent.click(screen.getByTestId("saved-add-btn"));
    const input = screen.getByTestId("saved-name-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // Allow the POST microtask to settle.
    await waitFor(() => {
      expect(screen.queryByTestId("saved-name-input")).toBeNull();
    });
    expect(screen.queryAllByTestId(/^saved-row-/)).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("a 507 disk-full POST is also silent — operator sees no row, console gets a warn", async () => {
    fetchState.override = (method) =>
      method === "POST" ? buildResponse({ error: "disk full" }, 507) : null;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    setup({ filters: { tier: "high" } });
    await awaitFirstFetch();

    fireEvent.click(screen.getByTestId("saved-add-btn"));
    const input = screen.getByTestId("saved-name-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(screen.queryByTestId("saved-name-input")).toBeNull();
    });
    expect(screen.queryAllByTestId(/^saved-row-/)).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("SavedSearchesGroup — migration on mount", () => {
  it("when the migration flag is unset and legacy entries exist, the hook POSTs them and they appear", async () => {
    localStorage.removeItem(MIGRATION_FLAG_KEY);
    const legacy = {
      v: 1,
      items: [
        {
          id: "legacy_seed",
          name: "legacy seed",
          filters: { tier: "high" },
          createdAt: "2026-04-26T10:00:00.000Z",
        },
      ],
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));

    setup();

    // After migration, the row appears.
    await waitFor(
      () => {
        const rows = screen.queryAllByTestId(/^saved-row-/).filter((el) => {
          const id = el.getAttribute("data-testid") ?? "";
          return !id.endsWith("-remove");
        });
        expect(rows).toHaveLength(1);
        expect(rows[0].textContent).toContain("legacy seed");
      },
      { timeout: 2000 },
    );

    // Migration flag now set; legacy key cleared.
    expect(localStorage.getItem(MIGRATION_FLAG_KEY)).toBe("1");
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    // Backend received the POST.
    const post = fetchMock.mock.calls.find(
      (c) => (c[1] as RequestInit | undefined)?.method === "POST",
    );
    expect(post).toBeDefined();
    const body = JSON.parse((post?.[1] as RequestInit).body as string);
    expect(body.name).toBe("legacy seed");
  });
});
