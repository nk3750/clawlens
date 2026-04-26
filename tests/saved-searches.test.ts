// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addSaved,
  loadSaved,
  removeSaved,
  renameSaved,
  STORAGE_KEY,
} from "../dashboard/src/lib/savedSearches";

// Fully exercise the localStorage failure modes from the spec:
//   - getItem throws (storage disabled / quota / private browsing)
//   - stored JSON malformed
//   - schema version mismatch (v !== 1)
//   - setItem throws (quota exceeded)
// All four must NOT crash — they must return safe empty values and log a warning
// (except getItem-throws which only needs to log once per page load).

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  localStorage.clear();
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("loadSaved", () => {
  it("returns [] when localStorage is empty", () => {
    expect(loadSaved()).toEqual([]);
  });

  it("returns parsed items when valid envelope { v: 1, items: [...] } is stored", () => {
    const item = {
      id: "ss_abc",
      name: "high blocks",
      filters: { tier: "high", decision: "block" },
      createdAt: "2026-04-26T00:00:00.000Z",
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, items: [item] }));
    expect(loadSaved()).toEqual([item]);
  });

  it("returns [] and logs a warning when stored v !== 1", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 2, items: [{ id: "x" }] }));
    expect(loadSaved()).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("returns [] and logs a warning when localStorage contains malformed JSON", () => {
    localStorage.setItem(STORAGE_KEY, "not-json{{");
    expect(loadSaved()).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("returns [] when localStorage throws on getItem (storage disabled)", () => {
    const orig = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error("storage disabled");
    };
    try {
      expect(loadSaved()).toEqual([]);
    } finally {
      Storage.prototype.getItem = orig;
    }
  });

  it("returns [] when envelope is missing the items array", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1 }));
    expect(loadSaved()).toEqual([]);
  });
});

describe("addSaved", () => {
  it("writes to localStorage and returns the new SavedSearch with id + createdAt", () => {
    const out = addSaved("blocks today", { decision: "block", since: "24h" });
    expect(out).not.toBeNull();
    expect(out!.id).toEqual(expect.any(String));
    expect(out!.id.length).toBeGreaterThan(0);
    expect(out!.name).toBe("blocks today");
    expect(out!.filters).toEqual({ decision: "block", since: "24h" });
    expect(out!.createdAt).toEqual(expect.any(String));
    // Round-trip persist + read.
    expect(loadSaved()).toEqual([out]);
  });

  it("appends new entries to the end (insertion order preserved across reads)", () => {
    const a = addSaved("a", { tier: "low" });
    const b = addSaved("b", { tier: "high" });
    expect(loadSaved()).toEqual([a, b]);
  });

  it("returns null and logs a warning when setItem throws (quota exceeded)", () => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("quota exceeded");
    };
    try {
      const out = addSaved("any", { tier: "high" });
      expect(out).toBeNull();
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      Storage.prototype.setItem = orig;
    }
  });

  it("two saves with the same name both persist (disambiguate by deleting)", () => {
    const a = addSaved("dup", { tier: "high" });
    const b = addSaved("dup", { tier: "low" });
    const items = loadSaved();
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual(a);
    expect(items[1]).toEqual(b);
    // Distinct ids so removal is unambiguous.
    expect(a!.id).not.toBe(b!.id);
  });

  it("writes the v:1 envelope shape (locked for 2.8 backend migration)", () => {
    addSaved("x", { tier: "high" });
    const raw = localStorage.getItem(STORAGE_KEY)!;
    const parsed = JSON.parse(raw);
    expect(parsed.v).toBe(1);
    expect(Array.isArray(parsed.items)).toBe(true);
  });
});

describe("removeSaved", () => {
  it("removes the matching item by id", () => {
    const a = addSaved("a", { tier: "high" });
    const b = addSaved("b", { tier: "low" });
    removeSaved(a!.id);
    expect(loadSaved()).toEqual([b]);
  });

  it("missing id is a no-op (does not crash)", () => {
    const a = addSaved("a", { tier: "high" });
    removeSaved("does-not-exist");
    expect(loadSaved()).toEqual([a]);
  });

  it("removing from empty list is a no-op", () => {
    removeSaved("anything");
    expect(loadSaved()).toEqual([]);
  });
});

describe("renameSaved", () => {
  it("updates the name on the matching item; other fields untouched", () => {
    const a = addSaved("old", { tier: "high" });
    renameSaved(a!.id, "new");
    const items = loadSaved();
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("new");
    expect(items[0].id).toBe(a!.id);
    expect(items[0].filters).toEqual(a!.filters);
    expect(items[0].createdAt).toBe(a!.createdAt);
  });

  it("missing id is a no-op", () => {
    const a = addSaved("a", { tier: "high" });
    renameSaved("does-not-exist", "new");
    expect(loadSaved()).toEqual([a]);
  });
});
