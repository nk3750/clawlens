import { useCallback, useEffect, useState } from "react";
import { filtersToApiQuery, type SessionFilters } from "../lib/sessionFilters";
import type { SessionInfo } from "../lib/types";

const API_BASE = "/plugins/clawlens";
/**
 * Spec §11.1 — default page size is 25 (matches the backend clamp default).
 * This client constant only governs how big "Load more" pages are; the first
 * fetch on the route reads the same value.
 */
export const SESSIONS_PAGE_SIZE = 25;

interface SessionsState {
  sessions: SessionInfo[];
  total: number;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  loadMore: () => void;
  refetch: () => void;
}

interface ApiResponse {
  sessions: SessionInfo[];
  total: number;
}

/**
 * Sessions list hook. Owns pagination state (offset/hasMore) so a filter
 * change refetches from offset 0 and discards the existing list, while
 * "Load more" appends.
 */
export function useSessions(filters: SessionFilters): SessionsState {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stable cache key: changes when any backend-relevant filter changes. View
  // is frontend-only (applyClientFilter) so it doesn't bust the cache.
  const cacheKey = `${filters.agent ?? ""}|${filters.risk ?? ""}|${filters.duration ?? ""}|${filters.since ?? ""}`;

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = `${API_BASE}/api/sessions?${filtersToApiQuery(filters, SESSIONS_PAGE_SIZE, 0)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ApiResponse;
      setSessions(data.sessions);
      setTotal(data.total);
      setHasMore(data.sessions.length < data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
    // refetch reads the latest filters via closure; cacheKey gates re-creation.
    // biome-ignore lint/correctness/useExhaustiveDependencies: cacheKey covers all backend filter inputs
  }, [cacheKey]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const offset = sessions.length;
      const url = `${API_BASE}/api/sessions?${filtersToApiQuery(filters, SESSIONS_PAGE_SIZE, offset)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ApiResponse;
      setSessions((prev) => [...prev, ...data.sessions]);
      setHasMore(offset + data.sessions.length < data.total);
    } catch {
      // Swallow: the operator can click Load more again to retry.
    } finally {
      setLoadingMore(false);
    }
  }, [filters, hasMore, loadingMore, sessions.length]);

  return { sessions, total, loading, loadingMore, hasMore, error, loadMore, refetch };
}
