import { useLayoutEffect, useRef, useState } from "react";

/**
 * Measures the strip's own rendered width with a ResizeObserver. Ensures
 * SVG viewBox width always matches the SVG's rendered pixel width so
 * circles never squash into ellipses. Runs in `useLayoutEffect` so the
 * measurement lands before the first paint — no visible squash flash.
 */
export function useStripWidth(): [
  React.RefObject<HTMLDivElement>,
  number,
] {
  const ref = useRef<HTMLDivElement>(null);
  // 800 is a sensible default for jsdom/SSR/first-paint — production updates
  // synchronously in the layout effect below.
  const [width, setWidth] = useState(800);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) setWidth(Math.floor(w));
    };
    update();
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(update)
        : null;
    if (observer) observer.observe(el);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  return [ref, width];
}
