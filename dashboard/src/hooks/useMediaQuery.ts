import { useEffect, useState } from "react";

/**
 * Live-tracks a CSS media query. Returns the current match state and updates
 * when the query changes (so resizing the window or toggling DevTools'
 * device emulation updates the UI without a reload).
 *
 * Falls back to `false` when `window.matchMedia` is unavailable — desktop
 * layout is the safer default for the rare browser without it (private mode
 * in some older builds, server-side render, etc.).
 *
 * Mirrors the pattern of `useReducedMotion` so behavior is uniform across
 * the dashboard's responsive hooks.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    // Sync after mount in case the initial-state closure raced a change.
    setMatches(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
