export function getPref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v != null ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function setPref<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore quota / disabled storage */
  }
}

export const PREF_KEYS = {
  FLEET_RANGE: "cl:fleet:range",
  AGENTS_SHOW_IDLE: "cl:agents:showIdle",
  AGENTS_TOP_N: "cl:agents:topN",
} as const;
