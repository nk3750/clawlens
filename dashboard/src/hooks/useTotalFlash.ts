import { useEffect, useRef, useState } from "react";

/**
 * Returns `true` for ~500ms whenever `total` changes by more than `thresholdPct`.
 *
 * - Silent on first render (no flash on initial mount / page load).
 * - Skips when prev total is 0 (avoids div-by-zero on the first non-empty value).
 * - Respects `prefers-reduced-motion` by never flashing when reduced-motion is on.
 */
export function useTotalFlash(total: number, thresholdPct = 2): boolean {
  const prevRef = useRef<number | null>(null);
  const [flashing, setFlashing] = useState(false);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = total;
    if (prev === null || prev === 0) return;

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;

    const deltaPct = Math.abs((total - prev) / prev) * 100;
    if (deltaPct < thresholdPct) return;

    setFlashing(true);
    const id = setTimeout(() => setFlashing(false), 500);
    return () => clearTimeout(id);
  }, [total, thresholdPct]);

  return flashing;
}
