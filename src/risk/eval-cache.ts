import * as crypto from "node:crypto";

export interface CachedEvaluation {
  adjustedScore: number;
  tier: string;
  tags: string[];
  reasoning: string;
  cachedAt: number;
  hitCount: number;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_CACHE_SIZE = 500;

/**
 * Caches LLM risk evaluations by action pattern.
 *
 * Pattern key = hash of (toolName + normalized params). When the LLM returns
 * a high-confidence evaluation with an adjusted score below the LLM threshold,
 * the result is cached. Future identical actions use the cached score and skip
 * the LLM call entirely.
 */
export class EvalCache {
  private cache = new Map<string, CachedEvaluation>();
  private ttlMs: number;

  constructor(ttlMs: number = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  /**
   * Build a cache key from tool name and params.
   * Normalizes params by sorting keys and stripping volatile values
   * (timestamps, random IDs) to increase cache hit rate.
   */
  static buildKey(toolName: string, params: Record<string, unknown>): string {
    const normalized = normalizeParams(toolName, params);
    const raw = `${toolName}:${JSON.stringify(normalized)}`;
    return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);
  }

  /** Look up a cached evaluation. Returns undefined on miss or expiry. */
  get(toolName: string, params: Record<string, unknown>): CachedEvaluation | undefined {
    const key = EvalCache.buildKey(toolName, params);
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (Date.now() - entry.cachedAt > this.ttlMs) {
      this.cache.delete(key);
      return undefined;
    }

    entry.hitCount++;
    return entry;
  }

  /**
   * Cache an LLM evaluation result if it qualifies:
   * - confidence must be "high"
   * - adjusted score must be below the LLM eval threshold
   */
  maybeCache(
    toolName: string,
    params: Record<string, unknown>,
    evaluation: {
      adjustedScore: number;
      confidence: string;
      tags: string[];
      reasoning: string;
    },
    llmEvalThreshold: number,
  ): boolean {
    if (evaluation.confidence !== "high") return false;
    if (evaluation.adjustedScore >= llmEvalThreshold) return false;

    const key = EvalCache.buildKey(toolName, params);

    // Evict oldest entries if at capacity
    if (this.cache.size >= MAX_CACHE_SIZE) {
      let oldestKey: string | undefined;
      let oldestTime = Infinity;
      for (const [k, v] of this.cache) {
        if (v.cachedAt < oldestTime) {
          oldestTime = v.cachedAt;
          oldestKey = k;
        }
      }
      if (oldestKey) this.cache.delete(oldestKey);
    }

    const tier =
      evaluation.adjustedScore >= 80 ? "critical" :
      evaluation.adjustedScore >= 60 ? "high" :
      evaluation.adjustedScore >= 30 ? "medium" : "low";

    this.cache.set(key, {
      adjustedScore: evaluation.adjustedScore,
      tier,
      tags: evaluation.tags,
      reasoning: evaluation.reasoning,
      cachedAt: Date.now(),
      hitCount: 0,
    });

    return true;
  }

  /** Number of cached patterns. */
  get size(): number {
    return this.cache.size;
  }

  /** Clear all cached evaluations. */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Pre-warm the cache from audit log entries that have real LLM evaluations.
   * Only caches entries with high-confidence evaluations.
   * Limit to last 200 qualifying entries.
   * Returns the number of entries warmed.
   */
  warmFromAuditLog(entries: Array<{
    toolName: string;
    params: Record<string, unknown>;
    llmEvaluation?: {
      adjustedScore: number;
      confidence: string;
      tags: string[];
      reasoning: string;
    };
  }>): number {
    // Filter to entries with high-confidence LLM evaluations
    const qualifying = entries.filter(
      (e) => e.llmEvaluation && e.llmEvaluation.confidence === "high",
    );

    // Take last 200 qualifying entries
    const toWarm = qualifying.slice(-200);

    let warmed = 0;
    for (const entry of toWarm) {
      const evaluation = entry.llmEvaluation!;
      const key = EvalCache.buildKey(entry.toolName, entry.params);

      // Don't overwrite existing entries
      if (this.cache.has(key)) continue;

      // Evict oldest if at capacity
      if (this.cache.size >= MAX_CACHE_SIZE) {
        let oldestKey: string | undefined;
        let oldestTime = Infinity;
        for (const [k, v] of this.cache) {
          if (v.cachedAt < oldestTime) {
            oldestTime = v.cachedAt;
            oldestKey = k;
          }
        }
        if (oldestKey) this.cache.delete(oldestKey);
      }

      const tier =
        evaluation.adjustedScore >= 80 ? "critical" :
        evaluation.adjustedScore >= 60 ? "high" :
        evaluation.adjustedScore >= 30 ? "medium" : "low";

      this.cache.set(key, {
        adjustedScore: evaluation.adjustedScore,
        tier,
        tags: evaluation.tags,
        reasoning: evaluation.reasoning,
        cachedAt: Date.now(),
        hitCount: 0,
      });

      warmed++;
    }

    return warmed;
  }
}

/**
 * Normalize params for cache key generation.
 * Strips volatile fields and normalizes paths so that minor variations
 * (different temp file names, timestamps in commands) still cache-hit.
 */
function normalizeParams(
  toolName: string,
  params: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(params)) {
    if (typeof value !== "string") {
      result[key] = value;
      continue;
    }

    let normalized = value;

    if (toolName === "exec" && key === "command") {
      // Strip inline timestamps, temp file paths, and PIDs from commands
      normalized = value
        .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[^\s]*/g, "<TIMESTAMP>")
        .replace(/\/tmp\/[^\s"']*/g, "/tmp/<TEMP>")
        .replace(/\bpid\s*=?\s*\d+/gi, "pid=<PID>");
    }

    result[key] = normalized;
  }

  // Sort keys for deterministic hashing
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(result).sort()) {
    sorted[key] = result[key];
  }
  return sorted;
}
