import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type SavedSearch,
  SavedSearchesStore,
  type SavedSearchFilters,
} from "../src/risk/saved-searches-store";

// Per-test temp dir so concurrent vitest workers can't collide and a single
// crashing test can't leak corrupt state into the next.
let tmpDir: string;
let filePath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawlens-saved-"));
  filePath = path.join(tmpDir, "activity-saved-searches.json");
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("SavedSearchesStore.load", () => {
  it("returns [] when the file does not exist (first run)", () => {
    const store = new SavedSearchesStore(filePath);
    store.load();
    expect(store.list()).toEqual([]);
  });

  it("returns [] when the file contains malformed JSON", () => {
    fs.writeFileSync(filePath, "{not json");
    const store = new SavedSearchesStore(filePath);
    store.load();
    expect(store.list()).toEqual([]);
  });

  it("returns [] when the envelope has the wrong schema version", () => {
    fs.writeFileSync(
      filePath,
      JSON.stringify({ v: 2, items: [{ id: "ss_x", name: "n", filters: {}, createdAt: "" }] }),
    );
    const store = new SavedSearchesStore(filePath);
    store.load();
    expect(store.list()).toEqual([]);
  });

  it("returns [] when the envelope is missing items array", () => {
    fs.writeFileSync(filePath, JSON.stringify({ v: 1 }));
    const store = new SavedSearchesStore(filePath);
    store.load();
    expect(store.list()).toEqual([]);
  });

  it("hydrates items from a valid v:1 envelope on disk", () => {
    const item: SavedSearch = {
      id: "ss_seed",
      name: "high blocks",
      filters: { tier: "high", decision: "block" },
      createdAt: "2026-04-26T10:00:00.000Z",
    };
    fs.writeFileSync(filePath, JSON.stringify({ v: 1, items: [item] }));
    const store = new SavedSearchesStore(filePath);
    store.load();
    expect(store.list()).toEqual([item]);
  });
});

describe("SavedSearchesStore.add", () => {
  it("returns the new item with ss_-prefixed id, ISO createdAt, and the supplied name + filters", () => {
    const store = new SavedSearchesStore(filePath);
    store.load();
    const filters: SavedSearchFilters = { tier: "high", decision: "block" };
    const item = store.add("blocks today", filters);
    expect(item.id).toMatch(/^ss_[0-9a-f]{12}$/);
    expect(item.name).toBe("blocks today");
    expect(item.filters).toEqual(filters);
    expect(new Date(item.createdAt).toISOString()).toBe(item.createdAt);
  });

  it("persists the v:1 envelope to disk after add", () => {
    const store = new SavedSearchesStore(filePath);
    store.load();
    store.add("x", { tier: "high" });
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(raw.v).toBe(1);
    expect(Array.isArray(raw.items)).toBe(true);
    expect(raw.items).toHaveLength(1);
    expect(raw.items[0].name).toBe("x");
  });

  it("appends — insertion order preserved across reads", () => {
    const store = new SavedSearchesStore(filePath);
    store.load();
    const a = store.add("a", { tier: "high" });
    const b = store.add("b", { tier: "low" });
    expect(store.list().map((s) => s.id)).toEqual([a.id, b.id]);
  });

  it("creates the parent directory if missing (mkdirp on first save)", () => {
    const nested = path.join(tmpDir, "nested", "deep", "saved.json");
    const store = new SavedSearchesStore(nested);
    store.load();
    store.add("x", {});
    expect(fs.existsSync(nested)).toBe(true);
  });

  it("two adds with identical names persist as distinct entries (dedup is the operator's job)", () => {
    const store = new SavedSearchesStore(filePath);
    store.load();
    const a = store.add("dup", { tier: "high" });
    const b = store.add("dup", { tier: "low" });
    expect(a.id).not.toBe(b.id);
    expect(store.list()).toHaveLength(2);
  });

  it("list() returns a copy — mutating the returned array does not affect store state", () => {
    const store = new SavedSearchesStore(filePath);
    store.load();
    store.add("x", {});
    const snapshot = store.list();
    snapshot.length = 0;
    expect(store.list()).toHaveLength(1);
  });
});

describe("SavedSearchesStore.remove", () => {
  it("removes the matching item by id and returns true", () => {
    const store = new SavedSearchesStore(filePath);
    store.load();
    const a = store.add("a", { tier: "high" });
    const b = store.add("b", { tier: "low" });
    expect(store.remove(a.id)).toBe(true);
    expect(store.list()).toEqual([b]);
  });

  it("returns false when the id does not exist", () => {
    const store = new SavedSearchesStore(filePath);
    store.load();
    store.add("a", { tier: "high" });
    expect(store.remove("ss_does_not_exist")).toBe(false);
    expect(store.list()).toHaveLength(1);
  });

  it("returns false on an empty list (no crash)", () => {
    const store = new SavedSearchesStore(filePath);
    store.load();
    expect(store.remove("anything")).toBe(false);
  });

  it("persists the removal — a fresh store at the same path sees the new state", () => {
    const store1 = new SavedSearchesStore(filePath);
    store1.load();
    const a = store1.add("a", { tier: "high" });
    store1.add("b", { tier: "low" });
    store1.remove(a.id);

    const store2 = new SavedSearchesStore(filePath);
    store2.load();
    expect(store2.list()).toHaveLength(1);
    expect(store2.list()[0].name).toBe("b");
  });
});

describe("SavedSearchesStore.rename", () => {
  it("updates the name on the matching item and returns the updated item", () => {
    const store = new SavedSearchesStore(filePath);
    store.load();
    const a = store.add("old", { tier: "high" });
    const updated = store.rename(a.id, "new");
    expect(updated).not.toBeNull();
    expect(updated?.name).toBe("new");
    expect(updated?.id).toBe(a.id);
    expect(updated?.filters).toEqual({ tier: "high" });
    expect(updated?.createdAt).toBe(a.createdAt);
  });

  it("returns null when the id does not exist", () => {
    const store = new SavedSearchesStore(filePath);
    store.load();
    store.add("a", { tier: "high" });
    expect(store.rename("ss_no_such_id", "new")).toBeNull();
  });

  it("persists the rename — a fresh store at the same path sees the new name", () => {
    const store1 = new SavedSearchesStore(filePath);
    store1.load();
    const a = store1.add("old", { tier: "high" });
    store1.rename(a.id, "new");

    const store2 = new SavedSearchesStore(filePath);
    store2.load();
    expect(store2.list()[0].name).toBe("new");
  });
});

describe("SavedSearchesStore — atomic write resilience", () => {
  // Validates the temp-then-rename pattern: a crash mid-write must NOT
  // corrupt the existing file. Operators losing one not-yet-saved entry is
  // acceptable; losing the whole list because of a partial write is not.
  //
  // We provoke a real EISDIR by pre-creating a directory at the temp-write
  // path — vitest's ESM module-namespace lock prevents spying on fs.* directly.
  it("when the temp write fails, the on-disk file from the prior successful save is intact", () => {
    const store = new SavedSearchesStore(filePath);
    store.load();
    const survivor = store.add("survivor", { tier: "high" });

    const tmpPath = `${filePath}.tmp`;
    fs.mkdirSync(tmpPath); // writeFileSync(tmpPath, …) will now throw EISDIR
    try {
      expect(() => store.add("doomed", { tier: "low" })).toThrow();
    } finally {
      fs.rmdirSync(tmpPath);
    }

    // The prior successful save must still be on disk untouched.
    const reload = new SavedSearchesStore(filePath);
    reload.load();
    expect(reload.list()).toEqual([survivor]);
  });

  it("when remove triggers a write that fails, both in-memory and on-disk state are unchanged (rollback)", () => {
    // The store must roll back the splice when save throws so the in-memory
    // list never diverges from disk. Without this, a failed POST in the route
    // would 507 to the user but a subsequent GET (before gateway restart)
    // would still surface the doomed entry.
    const store = new SavedSearchesStore(filePath);
    store.load();
    const a = store.add("a", { tier: "high" });
    const b = store.add("b", { tier: "low" });

    const tmpPath = `${filePath}.tmp`;
    fs.mkdirSync(tmpPath);
    try {
      expect(() => store.remove(a.id)).toThrow();
    } finally {
      fs.rmdirSync(tmpPath);
    }

    expect(store.list()).toEqual([a, b]);
    const reload = new SavedSearchesStore(filePath);
    reload.load();
    expect(reload.list()).toEqual([a, b]);
  });

  it("when add triggers a write that fails, the new entry is rolled back from in-memory state", () => {
    const store = new SavedSearchesStore(filePath);
    store.load();
    const survivor = store.add("survivor", { tier: "high" });

    const tmpPath = `${filePath}.tmp`;
    fs.mkdirSync(tmpPath);
    try {
      expect(() => store.add("doomed", { tier: "low" })).toThrow();
    } finally {
      fs.rmdirSync(tmpPath);
    }
    expect(store.list()).toEqual([survivor]);
  });

  it("when rename triggers a write that fails, the name change is rolled back from in-memory state", () => {
    const store = new SavedSearchesStore(filePath);
    store.load();
    const a = store.add("old", { tier: "high" });

    const tmpPath = `${filePath}.tmp`;
    fs.mkdirSync(tmpPath);
    try {
      expect(() => store.rename(a.id, "new")).toThrow();
    } finally {
      fs.rmdirSync(tmpPath);
    }
    expect(store.list()[0].name).toBe("old");
  });

  it("generateId() produces ss_-prefixed 12-hex-char ids that are unique across calls", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) ids.add(SavedSearchesStore.generateId());
    expect(ids.size).toBe(50);
    for (const id of ids) {
      expect(id).toMatch(/^ss_[0-9a-f]{12}$/);
    }
  });
});
