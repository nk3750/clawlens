import { useEffect, useMemo, useRef } from "react";
import { debounce } from "../lib/debounce";
import type { EntryResponse } from "../lib/types";
import { useApi } from "./useApi";
import { useSSE } from "./useSSE";

export interface UseLiveApiOptions {
  /**
   * Optional predicate on each SSE entry. If present, only entries that
   * satisfy the predicate trigger a refetch. Use for endpoints where most
   * entries don't change the response (e.g. /api/attention only cares about
   * pending/block/timeout/high-risk).
   *
   * If omitted, every entry event triggers a refetch — correct default for
   * aggregate endpoints like /api/stats and /api/agents where any entry moves
   * some counter.
   */
  filter?: (entry: EntryResponse) => boolean;

  /**
   * Debounce window in ms. Default 500ms — the latency target for the
   * homepage liveness spec. Lower values would hammer the API; higher values
   * feel stale.
   */
  debounceMs?: number;
}

/**
 * Fetch + live-stream wrapper around useApi. Subscribes to /api/stream and
 * triggers a debounced refetch on each entry (filter-gated when supplied).
 * On tab return (visibilitychange → visible) refetches immediately, since the
 * user's intent is explicit.
 *
 * Drop-in replacement for useApi — same return shape.
 */
export function useLiveApi<T>(
  path: string,
  opts?: UseLiveApiOptions,
): ReturnType<typeof useApi<T>> {
  const api = useApi<T>(path);
  const { refetch } = api;
  const debounceMs = opts?.debounceMs ?? 500;
  const filter = opts?.filter;

  // Track mount so a debounced timer that fires after unmount becomes a no-op.
  // The shared debounce() helper has no cancel(); the mountedRef guard
  // achieves the same outcome (skip the refetch instead of cancelling the
  // timer).
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const debouncedRefetch = useMemo(
    () =>
      debounce(() => {
        if (!mountedRef.current) return;
        refetch();
      }, debounceMs),
    [refetch, debounceMs],
  );

  useSSE<EntryResponse>("api/stream", (entry) => {
    if (filter && !filter(entry)) return;
    debouncedRefetch();
  });

  // Tab-return refetch: covers entries the user missed while the tab was
  // hidden, and any out-of-band state changes (resolved-elsewhere approvals).
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") refetch();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [refetch]);

  return api;
}
