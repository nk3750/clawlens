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
export declare class SavedSearchesStore {
    private all;
    private filePath;
    constructor(filePath: string);
    /** Load saved searches from disk. Missing/malformed/wrong-version → empty list, no throw. */
    load(): void;
    /** Persist atomically: write tmp, then rename. A crash mid-write leaves the prior file intact. */
    save(): void;
    add(name: string, filters: SavedSearchFilters): SavedSearch;
    remove(id: string): boolean;
    rename(id: string, name: string): SavedSearch | null;
    /** Returns a fresh copy so callers can't mutate internal state. */
    list(): SavedSearch[];
    static generateId(): string;
}
