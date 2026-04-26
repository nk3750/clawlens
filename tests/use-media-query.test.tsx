// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMediaQuery } from "../dashboard/src/hooks/useMediaQuery";

type MqlListener = (e: MediaQueryListEvent) => void;

interface FakeMql {
  matches: boolean;
  media: string;
  onchange: MqlListener | null;
  addEventListener: (type: "change", cb: MqlListener) => void;
  removeEventListener: (type: "change", cb: MqlListener) => void;
  /** Test hook — flip matches + fire change listeners. */
  flip(newMatches: boolean): void;
}

function installMatchMedia(initialMatches: boolean, query: string): FakeMql {
  const listeners = new Set<MqlListener>();
  const mql: FakeMql = {
    matches: initialMatches,
    media: query,
    onchange: null,
    addEventListener: (type, cb) => {
      if (type === "change") listeners.add(cb);
    },
    removeEventListener: (type, cb) => {
      if (type === "change") listeners.delete(cb);
    },
    flip(newMatches) {
      this.matches = newMatches;
      const event = { matches: newMatches } as MediaQueryListEvent;
      for (const l of listeners) l(event);
    },
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation(() => mql),
  );
  // biome-ignore lint/suspicious/noExplicitAny: test stub for a Web API
  window.matchMedia = vi.fn().mockImplementation(() => mql) as any;
  return mql;
}

describe("useMediaQuery", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    // Ensure jsdom default state — no window.matchMedia — between tests.
    // biome-ignore lint/suspicious/noExplicitAny: test reset for a Web API
    (window as unknown as Record<string, unknown>).matchMedia = undefined as any;
  });

  it("returns false when the query does not match initially", () => {
    installMatchMedia(false, "(max-width: 768px)");
    const { result } = renderHook(() => useMediaQuery("(max-width: 768px)"));
    expect(result.current).toBe(false);
  });

  it("returns true when the query matches initially", () => {
    installMatchMedia(true, "(max-width: 1023px)");
    const { result } = renderHook(() => useMediaQuery("(max-width: 1023px)"));
    expect(result.current).toBe(true);
  });

  it("updates when the media query flips to match", () => {
    const mql = installMatchMedia(false, "(max-width: 1023px)");
    const { result } = renderHook(() => useMediaQuery("(max-width: 1023px)"));
    expect(result.current).toBe(false);

    act(() => {
      mql.flip(true);
    });
    expect(result.current).toBe(true);
  });

  it("updates when the media query flips to no-match", () => {
    const mql = installMatchMedia(true, "(max-width: 639px)");
    const { result } = renderHook(() => useMediaQuery("(max-width: 639px)"));
    expect(result.current).toBe(true);

    act(() => {
      mql.flip(false);
    });
    expect(result.current).toBe(false);
  });

  it("removes its listener on unmount (no stray updates)", () => {
    const mql = installMatchMedia(false, "(max-width: 768px)");
    const { result, unmount } = renderHook(() => useMediaQuery("(max-width: 768px)"));
    unmount();
    expect(() => mql.flip(true)).not.toThrow();
    expect(result.current).toBe(false);
  });

  it("falls back to false when window.matchMedia is unavailable", () => {
    // biome-ignore lint/suspicious/noExplicitAny: simulate older/private-mode browsers
    (window as unknown as Record<string, unknown>).matchMedia = undefined as any;
    const { result } = renderHook(() => useMediaQuery("(max-width: 768px)"));
    expect(result.current).toBe(false);
  });
});
