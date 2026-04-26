import type { Filters } from "./activityFilters";

/**
 * One saved-search entry. Shape is stable across the localStorage backend
 * (Phase 2.3) and the gateway-side filesystem backend (Phase 2.8) — the v:1
 * envelope below lets a future migration read both safely.
 */
export interface SavedSearch {
  id: string;
  name: string;
  filters: Filters;
  /** ISO timestamp; populated at save time. */
  createdAt: string;
}

/** Storage envelope. `v` is locked at 1 until Phase 2.8 introduces a migration. */
interface Envelope {
  v: 1;
  items: SavedSearch[];
}

export const STORAGE_KEY = "clawlens.activity.savedSearches";
/**
 * One-shot flag set after the legacy localStorage entries are successfully
 * POSTed to the backend in Phase 2.8. Once `"1"`, migrateLocalToBackend()
 * becomes a no-op.
 */
export const MIGRATION_FLAG_KEY = "clawlens.activity.savedSearchesMigrated";
const SCHEMA_VERSION = 1;
const API_PATH = "/plugins/clawlens/api/saved-searches";

/**
 * One-time flag so a disabled-storage browser (private mode, quota=0) doesn't
 * spam the console on every read. Repeated parse/schema warnings are fine —
 * those indicate corruption that should stay loud until cleared.
 */
let loggedUnavailable = false;

function genId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function readEnvelope(): Envelope {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    if (!loggedUnavailable) {
      loggedUnavailable = true;
      console.warn("[savedSearches] localStorage unavailable; saved searches won't persist");
    }
    return { v: SCHEMA_VERSION, items: [] };
  }
  if (raw == null) return { v: SCHEMA_VERSION, items: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn("[savedSearches] malformed JSON in localStorage; resetting to empty");
    return { v: SCHEMA_VERSION, items: [] };
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as { v?: unknown }).v !== SCHEMA_VERSION ||
    !Array.isArray((parsed as { items?: unknown }).items)
  ) {
    if ((parsed as { v?: unknown })?.v !== SCHEMA_VERSION) {
      console.warn(
        `[savedSearches] schema version mismatch (expected ${SCHEMA_VERSION}); resetting to empty`,
      );
    }
    return { v: SCHEMA_VERSION, items: [] };
  }
  return parsed as Envelope;
}

function writeEnvelope(items: SavedSearch[]): boolean {
  const env: Envelope = { v: SCHEMA_VERSION, items };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(env));
    return true;
  } catch {
    console.warn("[savedSearches] localStorage write failed (quota or disabled)");
    return false;
  }
}

export function loadSaved(): SavedSearch[] {
  return readEnvelope().items;
}

/**
 * Persist a new entry. Returns the saved item (with generated id + createdAt)
 * on success, `null` if the underlying write failed. Callers must surface the
 * null case in UI rather than silently lose the click.
 */
export function addSaved(name: string, filters: Filters): SavedSearch | null {
  const item: SavedSearch = {
    id: genId(),
    name,
    filters: { ...filters },
    createdAt: new Date().toISOString(),
  };
  const items = [...readEnvelope().items, item];
  return writeEnvelope(items) ? item : null;
}

export function removeSaved(id: string): void {
  const env = readEnvelope();
  const next = env.items.filter((s) => s.id !== id);
  if (next.length === env.items.length) return;
  writeEnvelope(next);
}

export function renameSaved(id: string, name: string): void {
  const env = readEnvelope();
  let changed = false;
  const next = env.items.map((s) => {
    if (s.id !== id) return s;
    changed = true;
    return { ...s, name };
  });
  if (!changed) return;
  writeEnvelope(next);
}

// ── Phase 2.8 migration ────────────────────────────────────────────────
// One-shot move of legacy localStorage entries into the backend store. The
// flag persists across reloads so we never re-poll a successfully-migrated
// browser.

export function isMigrated(): boolean {
  try {
    return localStorage.getItem(MIGRATION_FLAG_KEY) === "1";
  } catch {
    // Storage disabled / private mode — treat as migrated to avoid pointless
    // retries; the backend is the source of truth either way.
    return true;
  }
}

function setMigratedFlag(): void {
  try {
    localStorage.setItem(MIGRATION_FLAG_KEY, "1");
  } catch {
    // Quota / disabled — silently swallow. Worst case the migration runs
    // again next page load and is a no-op (legacy is empty after success).
  }
}

function clearLegacyKey(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Best-effort.
  }
}

function writeLegacyEnvelope(items: SavedSearch[]): void {
  // Used by the partial-failure path to keep ONLY the entries that didn't
  // make it across, so the next migration retries just those.
  writeEnvelope(items);
}

/**
 * Migrate every legacy localStorage entry into the backend store via POST.
 *
 * - All-success → set the flag, clear the legacy key.
 * - Partial failure → leave only the failing entries in the legacy key,
 *   leave the flag unset so the next mount retries them.
 * - Already migrated / empty legacy → no-op, flag set so subsequent loads
 *   skip the call entirely.
 */
export async function migrateLocalToBackend(): Promise<{ migrated: number; failed: number }> {
  if (isMigrated()) return { migrated: 0, failed: 0 };

  const legacy = loadSaved();
  if (legacy.length === 0) {
    // Nothing to do, but flip the flag so we don't re-enter this branch on
    // every page load until the operator explicitly creates a search.
    setMigratedFlag();
    clearLegacyKey();
    return { migrated: 0, failed: 0 };
  }

  let migrated = 0;
  const failures: SavedSearch[] = [];

  for (const item of legacy) {
    try {
      const res = await fetch(API_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: item.name, filters: item.filters }),
      });
      if (res.ok) {
        migrated++;
      } else {
        failures.push(item);
      }
    } catch {
      failures.push(item);
    }
  }

  if (failures.length === 0) {
    setMigratedFlag();
    clearLegacyKey();
  } else {
    // Keep ONLY the failing entries in localStorage. Successful entries are
    // already on the backend; re-POSTing them would create duplicates.
    writeLegacyEnvelope(failures);
  }

  return { migrated, failed: failures.length };
}
