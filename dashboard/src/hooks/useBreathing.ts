import { useState, useEffect, useRef } from "react";
import { perlin2D } from "../lib/perlin";

interface BreathingOptions {
  /** Max displacement in 0-1 coordinate space (~4-5px in SVG). Default: 0.004 */
  amplitude?: number;
  /** Speed multiplier for Perlin time. Default: 0.0003 */
  speed?: number;
  /** ID of node to pin in place (e.g., hovered node). */
  pausedId?: string | null;
}

interface Position {
  x: number;
  y: number;
}

/**
 * Applies continuous Perlin noise drift to an array of positions.
 * Returns displaced positions every animation frame.
 *
 * - Each node drifts independently (seeded by index).
 * - Amplitude ramps from 0 to full over 2s after mount (smooth start after entrance).
 * - Pauses when tab is hidden (Page Visibility API).
 * - The `pausedId` node stays pinned at its equilibrium position.
 */
export function useBreathing<T extends Position>(
  positions: T[],
  nodeIds: string[],
  options: BreathingOptions = {},
): T[] {
  const { amplitude = 0.004, speed = 0.0003, pausedId = null } = options;

  const [displaced, setDisplaced] = useState<T[]>(positions);
  const frameRef = useRef(0);
  const mountTime = useRef(Date.now());
  const posRef = useRef(positions);
  const idsRef = useRef(nodeIds);
  const pausedRef = useRef(pausedId);

  // Keep refs current without restarting the loop
  posRef.current = positions;
  idsRef.current = nodeIds;
  pausedRef.current = pausedId;

  useEffect(() => {
    let running = true;
    mountTime.current = Date.now();

    function tick() {
      if (!running) return;

      const elapsed = Date.now() - mountTime.current;
      const t = elapsed * speed;

      // Ramp amplitude from 0→1 over first 2000ms (smooth start after entrance animation)
      const ramp = Math.min(1, elapsed / 2000);
      const amp = amplitude * ramp;

      const currentPositions = posRef.current;
      const currentIds = idsRef.current;
      const currentPaused = pausedRef.current;

      const next = currentPositions.map((p, i) => {
        if (currentIds[i] === currentPaused) return p;
        return {
          ...p,
          x: p.x + perlin2D(i * 100, t) * amp,
          y: p.y + perlin2D(i * 100 + 500, t) * amp,
        };
      });

      setDisplaced(next);
      frameRef.current = requestAnimationFrame(tick);
    }

    frameRef.current = requestAnimationFrame(tick);

    return () => {
      running = false;
      cancelAnimationFrame(frameRef.current);
    };
  }, [amplitude, speed]);

  // Pause when tab hidden
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(frameRef.current);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  return displaced;
}
