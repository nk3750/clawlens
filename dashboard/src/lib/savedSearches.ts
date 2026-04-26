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
const SCHEMA_VERSION = 1;

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
