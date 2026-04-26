import { useCallback, useEffect, useRef, useState } from "react";
import type { Filters } from "../lib/activityFilters";
import {
  isMigrated,
  migrateLocalToBackend,
  type SavedSearch,
} from "../lib/savedSearches";
import { useApi } from "./useApi";

const API_PATH = "/plugins/clawlens/api/saved-searches";

interface SavedSearchesResponse {
  items: SavedSearch[];
}

export interface UseSavedSearches {
  items: SavedSearch[];
  loading: boolean;
  error: string | null;
  add: (name: string, filters: Filters) => Promise<SavedSearch | null>;
  remove: (id: string) => Promise<boolean>;
  rename: (id: string, name: string) => Promise<SavedSearch | null>;
  refetch: () => Promise<void>;
}

/**
 * Backend-sourced saved-searches state with one-shot localStorage migration
 * (Phase 2.8, #36).
 *
 * On first mount per browser, kicks off `migrateLocalToBackend()` which
 * POSTs every legacy entry to the backend, then forces a refetch so the
 * surfaced list includes them. Subsequent mounts (flag set) skip migration
 * entirely.
 *
 * `loading` stays true while EITHER the underlying useApi fetch is in
 * flight OR the one-shot migration is still running, so consumers can
 * show a single spinner without juggling two states.
 */
export function useSavedSearches(): UseSavedSearches {
  const { data, loading: apiLoading, error, refetch } = useApi<SavedSearchesResponse>(
    "api/saved-searches",
  );
  // Migrating starts true if there's anything to do (legacy entries present
  // and flag unset); flips false once the one-shot promise resolves. Using a
  // ref to gate the effect prevents StrictMode's double-mount from firing
  // two migration runs.
  const [migrating, setMigrating] = useState<boolean>(() => !isMigrated());
  const migrationStarted = useRef(false);

  useEffect(() => {
    if (migrationStarted.current) return;
    migrationStarted.current = true;
    if (isMigrated()) {
      setMigrating(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        await migrateLocalToBackend();
        if (cancelled) return;
        // Backend now has the migrated rows; surface them.
        await refetch();
      } finally {
        if (!cancelled) setMigrating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refetch]);

  const add = useCallback(
    async (name: string, filters: Filters): Promise<SavedSearch | null> => {
      try {
        const res = await fetch(API_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, filters }),
        });
        if (!res.ok) {
          // Surface in the console for diagnosis; the hook's error state
          // belongs to the GET path, not mutation. UI degrades silently —
          // we deliberately skipped toast UI for this phase.
          console.warn(`[useSavedSearches] add failed: HTTP ${res.status}`);
          return null;
        }
        const body = (await res.json()) as { item: SavedSearch };
        await refetch();
        return body.item;
      } catch (err) {
        console.warn("[useSavedSearches] add threw:", err);
        return null;
      }
    },
    [refetch],
  );

  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const res = await fetch(`${API_PATH}/${encodeURIComponent(id)}`, { method: "DELETE" });
        if (!res.ok) {
          console.warn(`[useSavedSearches] remove failed: HTTP ${res.status}`);
          return false;
        }
        await refetch();
        return true;
      } catch (err) {
        console.warn("[useSavedSearches] remove threw:", err);
        return false;
      }
    },
    [refetch],
  );

  const rename = useCallback(
    async (id: string, name: string): Promise<SavedSearch | null> => {
      try {
        const res = await fetch(`${API_PATH}/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        if (!res.ok) {
          console.warn(`[useSavedSearches] rename failed: HTTP ${res.status}`);
          return null;
        }
        const body = (await res.json()) as { item: SavedSearch };
        await refetch();
        return body.item;
      } catch (err) {
        console.warn("[useSavedSearches] rename threw:", err);
        return null;
      }
    },
    [refetch],
  );

  return {
    items: data?.items ?? [],
    loading: apiLoading || migrating,
    error,
    add,
    remove,
    rename,
    refetch,
  };
}
