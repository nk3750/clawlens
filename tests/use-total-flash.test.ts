// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTotalFlash } from "../dashboard/src/hooks/useTotalFlash";

/** Stub `window.matchMedia` because jsdom doesn't ship one. */
function stubMatchMedia(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches,
      media: "",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  );
  // jsdom uses window.matchMedia; ensure both are set so the optional-chain in
  // the hook resolves consistently.
  window.matchMedia = (window.matchMedia ??
    // biome-ignore lint/suspicious/noExplicitAny: test stub for a Web API
    ((q: string) => ({ matches, media: q }) as any)) as typeof window.matchMedia;
}

describe("useTotalFlash", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubMatchMedia(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not flash on first render", () => {
    const { result } = renderHook(({ total }) => useTotalFlash(total), {
      initialProps: { total: 100 },
    });
    expect(result.current).toBe(false);
  });

  it("flashes when total jumps by more than the threshold", () => {
    const { result, rerender } = renderHook(({ total }) => useTotalFlash(total), {
      initialProps: { total: 100 },
    });
    expect(result.current).toBe(false);

    rerender({ total: 110 }); // +10% — well above the default 2%
    expect(result.current).toBe(true);
  });

  it("clears the flash after ~500ms", () => {
    const { result, rerender } = renderHook(({ total }) => useTotalFlash(total), {
      initialProps: { total: 100 },
    });
    rerender({ total: 110 });
    expect(result.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current).toBe(false);
  });

  it("does not flash when delta is below the threshold", () => {
    const { result, rerender } = renderHook(({ total }) => useTotalFlash(total), {
      initialProps: { total: 100 },
    });
    rerender({ total: 101 }); // +1% — below the 2% default
    expect(result.current).toBe(false);
  });

  it("flashes on a downward swing too (uses absolute delta)", () => {
    const { result, rerender } = renderHook(({ total }) => useTotalFlash(total), {
      initialProps: { total: 100 },
    });
    rerender({ total: 50 }); // -50%
    expect(result.current).toBe(true);
  });

  it("does not divide by zero when prev is 0", () => {
    const { result, rerender } = renderHook(({ total }) => useTotalFlash(total), {
      initialProps: { total: 0 },
    });
    rerender({ total: 100 });
    // First non-zero value should not flash (avoids div-by-zero in pct calc).
    expect(result.current).toBe(false);
  });

  it("respects prefers-reduced-motion", () => {
    stubMatchMedia(true); // reduced-motion ON
    const { result, rerender } = renderHook(({ total }) => useTotalFlash(total), {
      initialProps: { total: 100 },
    });
    rerender({ total: 200 });
    expect(result.current).toBe(false);
  });

  it("honors a custom thresholdPct", () => {
    const { result, rerender } = renderHook(({ total, t }) => useTotalFlash(total, t), {
      initialProps: { total: 100, t: 20 },
    });
    rerender({ total: 110, t: 20 }); // +10% but threshold is 20% → no flash
    expect(result.current).toBe(false);

    rerender({ total: 140, t: 20 }); // +27% from 110 → flash
    expect(result.current).toBe(true);
  });

  it("flashes again when a second large delta arrives after the first cleared", () => {
    const { result, rerender } = renderHook(({ total }) => useTotalFlash(total), {
      initialProps: { total: 100 },
    });
    rerender({ total: 200 });
    expect(result.current).toBe(true);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current).toBe(false);

    rerender({ total: 400 });
    expect(result.current).toBe(true);
  });
});
