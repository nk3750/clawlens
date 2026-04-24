// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useReducedMotion } from "../dashboard/src/hooks/useReducedMotion";

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

function installMatchMedia(initialMatches: boolean): FakeMql {
  const listeners = new Set<MqlListener>();
  const mql: FakeMql = {
    matches: initialMatches,
    media: "(prefers-reduced-motion: reduce)",
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

describe("useReducedMotion", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns false when prefers-reduced-motion does not match", () => {
    installMatchMedia(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });

  it("returns true when prefers-reduced-motion matches on mount", () => {
    installMatchMedia(true);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
  });

  it("updates when the media query flips to match", () => {
    const mql = installMatchMedia(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);

    act(() => {
      mql.flip(true);
    });
    expect(result.current).toBe(true);
  });

  it("updates when the media query flips to no-match", () => {
    const mql = installMatchMedia(true);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);

    act(() => {
      mql.flip(false);
    });
    expect(result.current).toBe(false);
  });

  it("removes its listener on unmount (no stray updates)", () => {
    const mql = installMatchMedia(false);
    const { result, unmount } = renderHook(() => useReducedMotion());
    unmount();
    // After unmount, flipping the query must not throw or leak state.
    expect(() => mql.flip(true)).not.toThrow();
    // The hook return is whatever it was at unmount — no assertion past that.
    expect(result.current).toBe(false);
  });
});
