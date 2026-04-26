import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * URL-shaped filter set persisted with each saved search. Keys mirror
 * dashboard/src/lib/activityFilters.ts::Filters — the frontend speaks `tier`
 * (not the backend's `riskTier`); the store persists what the frontend sends
 * and the translation lives in Activity.tsx::buildEntriesQuery.
 */
export interface SavedSearchFilters {
  agent?: string;
  category?: string;
  tier?: string;
  decision?: string;
  since?: string;
  q?: string;
}

export interface SavedSearch {
  id: string;
  name: string;
  filters: SavedSearchFilters;
  /** ISO 8601 timestamp populated at save time. */
  createdAt: string;
}

interface SavedSearchEnvelope {
  v: 1;
  items: SavedSearch[];
}

const SCHEMA_VERSION = 1;

export class SavedSearchesStore {
  private all: SavedSearch[] = [];
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /** Load saved searches from disk. Missing/malformed/wrong-version → empty list, no throw. */
  load(): void {
    this.all = [];
    if (!fs.existsSync(this.filePath)) return;
    try {
      const content = fs.readFileSync(this.filePath, "utf-8");
      const data = JSON.parse(content) as SavedSearchEnvelope;
      if (data.v !== SCHEMA_VERSION || !Array.isArray(data.items)) return;
      this.all = data.items;
    } catch {
      // Corrupted file — start fresh. New writes overwrite the bad file.
      return;
    }
  }

  /** Persist atomically: write tmp, then rename. A crash mid-write leaves the prior file intact. */
  save(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const data: SavedSearchEnvelope = { v: SCHEMA_VERSION, items: this.all };
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
    fs.renameSync(tmpPath, this.filePath);
  }

  add(name: string, filters: SavedSearchFilters): SavedSearch {
    const item: SavedSearch = {
      id: SavedSearchesStore.generateId(),
      name,
      filters: { ...filters },
      createdAt: new Date().toISOString(),
    };
    this.all.push(item);
    try {
      this.save();
    } catch (err) {
      // Roll back so in-memory state never diverges from disk on save failure.
      // Routes that catch the rethrow can then map ENOSPC/EISDIR/EROFS to 507
      // and the next GET sees the pre-failure list.
      this.all.pop();
      throw err;
    }
    return item;
  }

  remove(id: string): boolean {
    const idx = this.all.findIndex((s) => s.id === id);
    if (idx === -1) return false;
    const [removed] = this.all.splice(idx, 1);
    try {
      this.save();
    } catch (err) {
      this.all.splice(idx, 0, removed);
      throw err;
    }
    return true;
  }

  rename(id: string, name: string): SavedSearch | null {
    const item = this.all.find((s) => s.id === id);
    if (!item) return null;
    const previousName = item.name;
    item.name = name;
    try {
      this.save();
    } catch (err) {
      item.name = previousName;
      throw err;
    }
    return item;
  }

  /** Returns a fresh copy so callers can't mutate internal state. */
  list(): SavedSearch[] {
    return [...this.all];
  }

  static generateId(): string {
    return `ss_${crypto.randomBytes(6).toString("hex")}`;
  }
}
