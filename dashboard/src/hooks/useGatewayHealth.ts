import { useEffect, useRef, useState } from "react";

const BASE = "/plugins/clawlens";
const DEFAULT_POLL_MS = 10_000;
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_FAILURE_THRESHOLD = 2;

export type GatewayHealthStatus = "unknown" | "ok" | "down";

export interface UseGatewayHealthOptions {
  pollMs?: number;
  timeoutMs?: number;
  failureThreshold?: number;
  /** Override fetch — primarily for tests. */
  fetchImpl?: typeof fetch;
}

interface PollContext {
  controller: AbortController;
  superseded: boolean;
}

/**
 * Light-weight liveness probe for the ClawLens gateway. Polls /api/health on
 * a fixed cadence and emits a tri-state status that the nav-bar dot consumes.
 *
 * Replaces the prior SSE-based liveness chrome which suffered from Chrome's
 * per-origin HTTP/1.1 connection cap (issue #19) — a single short-lived
 * fetch per cycle costs far less than a parked EventSource.
 *
 * Failure threshold avoids flicker: a single transient error never flips the
 * UI to "down". `unknown` is the initial state; once a verdict is reached,
 * the hook moves between "ok" and "down" only.
 */
export function useGatewayHealth(opts: UseGatewayHealthOptions = {}): GatewayHealthStatus {
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const failureThreshold = opts.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
  const fetchImpl = opts.fetchImpl;

  const [status, setStatus] = useState<GatewayHealthStatus>("unknown");

  // Refs survive rerenders — the failure counter and in-flight ctx must
  // persist across the async poll boundary.
  const failuresRef = useRef(0);
  const inFlightRef = useRef<PollContext | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetcher: typeof fetch =
      fetchImpl ?? ((globalThis.fetch as typeof fetch).bind(globalThis));

    const poll = async (): Promise<void> => {
      // Supersede any prior in-flight poll so its catch handler skips
      // the failure increment when we abort it ourselves.
      const prior = inFlightRef.current;
      if (prior) {
        prior.superseded = true;
        prior.controller.abort();
      }

      const ctx: PollContext = { controller: new AbortController(), superseded: false };
      inFlightRef.current = ctx;
      const timeoutId = setTimeout(() => ctx.controller.abort(), timeoutMs);

      try {
        const res = await fetcher(`${BASE}/api/health`, { signal: ctx.controller.signal });
        if (cancelled || ctx.superseded) return;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // Drain the body so the connection is freed; we don't currently
        // surface lastEntryTimestamp through the hook.
        await res.json().catch(() => undefined);
        if (cancelled || ctx.superseded) return;
        failuresRef.current = 0;
        setStatus("ok");
      } catch {
        if (cancelled || ctx.superseded) return;
        failuresRef.current += 1;
        if (failuresRef.current >= failureThreshold) {
          setStatus("down");
        }
      } finally {
        clearTimeout(timeoutId);
        if (inFlightRef.current === ctx) {
          inFlightRef.current = null;
        }
      }
    };

    // Kick off immediately so the dot leaves "unknown" as soon as possible.
    void poll();
    const intervalId = setInterval(() => {
      void poll();
    }, pollMs);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
      const inFlight = inFlightRef.current;
      if (inFlight) {
        inFlight.superseded = true;
        inFlight.controller.abort();
        inFlightRef.current = null;
      }
    };
  }, [pollMs, timeoutMs, failureThreshold, fetchImpl]);

  return status;
}
