import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPref, PREF_KEYS, setPref } from "../dashboard/src/lib/prefs";

/**
 * Minimal in-memory localStorage. We avoid jsdom/happy-dom here — the helper is
 * pure enough that a hand-rolled mock exercises the same surface.
 */
function createStorageMock() {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => (store.has(key) ? (store.get(key) as string) : null)),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => {
      store.clear();
    }),
    key: vi.fn((i: number) => Array.from(store.keys())[i] ?? null),
    get length() {
      return store.size;
    },
    _store: store,
  };
}

describe("prefs — round-trip", () => {
  let mock: ReturnType<typeof createStorageMock>;

  beforeEach(() => {
    mock = createStorageMock();
    vi.stubGlobal("localStorage", mock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("round-trips a string value", () => {
    setPref("k:str", "hello");
    expect(getPref("k:str", "fallback")).toBe("hello");
  });

  it("round-trips a number value", () => {
    setPref("k:num", 42);
    expect(getPref("k:num", 0)).toBe(42);
  });

  it("round-trips a boolean value", () => {
    setPref("k:bool", true);
    expect(getPref("k:bool", false)).toBe(true);
  });

  it("round-trips an object value", () => {
    const obj = { a: 1, b: "x", nested: { c: true } };
    setPref("k:obj", obj);
    expect(getPref("k:obj", {})).toEqual(obj);
  });

  it("round-trips an array value", () => {
    setPref("k:arr", [1, 2, 3]);
    expect(getPref<number[]>("k:arr", [])).toEqual([1, 2, 3]);
  });

  it("overwrites previous values", () => {
    setPref("k:over", 1);
    setPref("k:over", 2);
    expect(getPref("k:over", 0)).toBe(2);
  });
});

describe("prefs — missing / fallback", () => {
  let mock: ReturnType<typeof createStorageMock>;

  beforeEach(() => {
    mock = createStorageMock();
    vi.stubGlobal("localStorage", mock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns fallback when key is absent", () => {
    expect(getPref("k:missing", "default")).toBe("default");
  });

  it("does not confuse stored `null` with missing", () => {
    // JSON.stringify(null) === "null" — getItem returns "null", JSON.parse → null
    setPref<null>("k:null", null);
    const v = getPref<null | string>("k:null", "fallback");
    expect(v).toBeNull();
  });

  it("returns fallback when stored value is not valid JSON", () => {
    // Bypass setPref to inject a corrupt string
    mock._store.set("k:corrupt", "{not json");
    expect(getPref("k:corrupt", "fallback")).toBe("fallback");
  });
});

describe("prefs — error handling", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("setPref swallows quota / security errors from setItem", () => {
    const throwing = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        throw new Error("QuotaExceededError");
      }),
      removeItem: vi.fn(),
      clear: vi.fn(),
      key: vi.fn(() => null),
      length: 0,
    };
    vi.stubGlobal("localStorage", throwing);
    expect(() => setPref("k", "v")).not.toThrow();
    expect(throwing.setItem).toHaveBeenCalledOnce();
  });

  it("getPref returns fallback when getItem throws (storage disabled)", () => {
    const throwing = {
      getItem: vi.fn(() => {
        throw new Error("SecurityError");
      }),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
      key: vi.fn(() => null),
      length: 0,
    };
    vi.stubGlobal("localStorage", throwing);
    expect(getPref("k", "fallback")).toBe("fallback");
  });

  it("getPref returns fallback when localStorage is undefined (SSR / Node)", () => {
    // No stub — localStorage is undefined in Node
    expect(() => getPref("k", "safe")).not.toThrow();
    expect(getPref("k", "safe")).toBe("safe");
  });

  it("setPref is a no-op when localStorage is undefined (SSR / Node)", () => {
    expect(() => setPref("k", "v")).not.toThrow();
  });
});

describe("PREF_KEYS", () => {
  it("exposes the three documented keys from §10", () => {
    expect(PREF_KEYS.FLEET_RANGE).toBe("cl:fleet:range");
    expect(PREF_KEYS.AGENTS_SHOW_IDLE).toBe("cl:agents:showIdle");
    expect(PREF_KEYS.AGENTS_TOP_N).toBe("cl:agents:topN");
  });
});
