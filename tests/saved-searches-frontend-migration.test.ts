// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isMigrated,
  MIGRATION_FLAG_KEY,
  migrateLocalToBackend,
  STORAGE_KEY,
} from "../dashboard/src/lib/savedSearches";

// One-shot localStorage → backend migration. Must:
//   1. POST every legacy entry on first run
//   2. Set the migration flag and clear localStorage when ALL POSTs succeed
//   3. Leave only failing entries in localStorage and NOT set the flag on
//      partial failure (next mount retries just those)
//   4. Be a no-op when the flag is already set
//   5. Be a no-op when localStorage is empty (still set the flag so we don't
//      poll on every page load)

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

function seedLocal(items: Array<{ id?: string; name: string; filters: Record<string, string> }>) {
  const envelope = {
    v: 1,
    items: items.map((it) => ({
      id: it.id ?? `legacy_${it.name}`,
      name: it.name,
      filters: it.filters,
      createdAt: "2026-04-26T10:00:00.000Z",
    })),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
}

function ok(item: unknown) {
  return { ok: true, status: 200, json: async () => ({ item }) };
}

function notOk(status: number) {
  return { ok: false, status, json: async () => ({ error: "boom" }) };
}

describe("migrateLocalToBackend — happy path", () => {
  it("POSTs every legacy entry to /plugins/clawlens/api/saved-searches", async () => {
    seedLocal([
      { name: "a", filters: { tier: "high" } },
      { name: "b", filters: { decision: "block" } },
      { name: "c", filters: { since: "1h" } },
    ]);
    fetchMock.mockResolvedValue(ok({ id: "ss_x", name: "x", filters: {}, createdAt: "" }));

    const result = await migrateLocalToBackend();
    expect(result).toEqual({ migrated: 3, failed: 0 });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const call of fetchMock.mock.calls) {
      const [url, init] = call as [string, RequestInit];
      expect(url).toBe("/plugins/clawlens/api/saved-searches");
      expect(init.method).toBe("POST");
      expect(init.headers).toEqual(expect.objectContaining({ "Content-Type": "application/json" }));
      const body = JSON.parse(init.body as string);
      expect(typeof body.name).toBe("string");
      expect(typeof body.filters).toBe("object");
    }
  });

  it("sets the migration flag and clears the legacy key when all POSTs succeed", async () => {
    seedLocal([{ name: "a", filters: { tier: "high" } }]);
    fetchMock.mockResolvedValue(ok({ id: "ss_x", name: "a", filters: {}, createdAt: "" }));

    await migrateLocalToBackend();

    expect(localStorage.getItem(MIGRATION_FLAG_KEY)).toBe("1");
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(isMigrated()).toBe(true);
  });
});

describe("migrateLocalToBackend — partial failure", () => {
  it("leaves only the failing entry in localStorage and does NOT set the flag", async () => {
    seedLocal([
      { id: "legacy_a", name: "a", filters: { tier: "high" } },
      { id: "legacy_b", name: "b", filters: { decision: "block" } },
      { id: "legacy_c", name: "c", filters: { since: "1h" } },
    ]);
    // Second POST fails (the "b" entry); the others succeed.
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      if (body.name === "b") return notOk(500);
      return ok({ id: "ss_ok", name: body.name, filters: body.filters, createdAt: "" });
    });

    const result = await migrateLocalToBackend();
    expect(result).toEqual({ migrated: 2, failed: 1 });

    // Flag NOT set so the next mount retries.
    expect(localStorage.getItem(MIGRATION_FLAG_KEY)).toBeNull();
    expect(isMigrated()).toBe(false);

    // Legacy key now contains ONLY the failing entry, not the survivors.
    const remaining = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(remaining.v).toBe(1);
    expect(remaining.items).toHaveLength(1);
    expect(remaining.items[0].name).toBe("b");
  });

  it("a follow-up call after the failing endpoint recovers retries only the leftover and then sets the flag", async () => {
    seedLocal([
      { id: "legacy_a", name: "a", filters: {} },
      { id: "legacy_b", name: "b", filters: {} },
    ]);

    // First run: "b" fails.
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      if (body.name === "b") return notOk(500);
      return ok({ id: "ss_ok", name: body.name, filters: body.filters, createdAt: "" });
    });
    await migrateLocalToBackend();
    expect(localStorage.getItem(MIGRATION_FLAG_KEY)).toBeNull();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).items).toHaveLength(1);

    // Second run: backend now accepts "b". Only one call this time.
    fetchMock.mockClear();
    fetchMock.mockResolvedValue(ok({ id: "ss_b", name: "b", filters: {}, createdAt: "" }));
    const result = await migrateLocalToBackend();
    expect(result).toEqual({ migrated: 1, failed: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(MIGRATION_FLAG_KEY)).toBe("1");
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("treats a fetch network rejection as a failure (entry stays in localStorage)", async () => {
    seedLocal([{ name: "a", filters: {} }]);
    fetchMock.mockRejectedValue(new Error("network down"));

    const result = await migrateLocalToBackend();
    expect(result).toEqual({ migrated: 0, failed: 1 });
    expect(localStorage.getItem(MIGRATION_FLAG_KEY)).toBeNull();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).items).toHaveLength(1);
  });
});

describe("migrateLocalToBackend — already migrated", () => {
  it("is a no-op (no fetch calls) when the migration flag is set", async () => {
    localStorage.setItem(MIGRATION_FLAG_KEY, "1");
    seedLocal([{ name: "a", filters: {} }]);
    // Even with legacy data still present, migration must skip — the flag
    // is the source of truth that migration already ran.

    const result = await migrateLocalToBackend();
    expect(result).toEqual({ migrated: 0, failed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(isMigrated()).toBe(true);
  });
});

describe("migrateLocalToBackend — empty localStorage", () => {
  it("sets the migration flag immediately so subsequent page loads do not poll", async () => {
    // No seedLocal — STORAGE_KEY is unset entirely.
    const result = await migrateLocalToBackend();
    expect(result).toEqual({ migrated: 0, failed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(localStorage.getItem(MIGRATION_FLAG_KEY)).toBe("1");
    expect(isMigrated()).toBe(true);
  });

  it("treats a stored envelope with an empty items array as already-migrated", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, items: [] }));
    const result = await migrateLocalToBackend();
    expect(result).toEqual({ migrated: 0, failed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(localStorage.getItem(MIGRATION_FLAG_KEY)).toBe("1");
  });
});

describe("isMigrated", () => {
  it("returns false when the flag is unset", () => {
    expect(isMigrated()).toBe(false);
  });

  it("returns true when the flag is set to '1'", () => {
    localStorage.setItem(MIGRATION_FLAG_KEY, "1");
    expect(isMigrated()).toBe(true);
  });

  it("returns false for any other flag value (defensive)", () => {
    localStorage.setItem(MIGRATION_FLAG_KEY, "true");
    expect(isMigrated()).toBe(false);
  });
});
