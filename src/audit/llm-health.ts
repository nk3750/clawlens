/**
 * LLM health tracker — rolling record of Claude/OpenAI/etc. call outcomes
 * so the dashboard can flag when eval or summary calls are degraded.
 *
 * Instances: a singleton `llmHealthTracker` is exported and wired at every
 * LLM call site in ClawLens (risk evaluator + session summarizer).
 * The class itself is exported for tests and future scoped usage.
 */

export type LlmFailureReason = "no_key" | "billing" | "rate_limit" | "provider" | "other";
export type LlmHealthStatus = "ok" | "degraded" | "down";

export interface LlmHealthAttempt {
  timestamp: number;
  ok: boolean;
  reason?: LlmFailureReason;
}

export interface LlmHealthSnapshot {
  /** Attempts that landed inside the 15-minute rolling window. */
  recentAttempts: number;
  /** Failures within the same window. */
  recentFailures: number;
  lastFailureIso?: string;
  lastFailureReason?: LlmFailureReason;
  status: LlmHealthStatus;
}

const RING_SIZE = 50;
const WINDOW_MS = 15 * 60 * 1000;

/**
 * Classify a raw error message into a structured reason. Pattern list matches
 * the spec — callers pass `err.message` or equivalent. Never-seen messages
 * fall through to "other" so the tracker still records them.
 */
export function classifyError(errMsg?: string): LlmFailureReason {
  if (!errMsg) return "other";
  // "no_key" must come first: a modelAuth failure that incidentally mentions
  // a rate-limit number or billing string still needs the operator to add a
  // key, not wait out a 429 or top up. Call-site strings to match:
  //   - src/dashboard/session-summary.ts:407 → "modelAuth: no api key"
  //   - src/risk/llm-evaluator.ts:341         → "modelAuth: no api key"
  //   - src/risk/llm-evaluator.ts:357 thrown err.message → often
  //     "modelAuth key resolution failed: ..."
  if (/modelAuth|no\s+api\s+key|provider\s+key\s+resolution|key\s+resolution/i.test(errMsg)) {
    return "no_key";
  }
  // Production messages say "credit balance is too low" — keep the match
  // loose enough to cover that plus explicit "billing" references.
  if (/credit balance|billing/i.test(errMsg)) return "billing";
  if (/rate.?limit|\b429\b/i.test(errMsg)) return "rate_limit";
  if (/\b5\d\d\b/.test(errMsg)) return "provider";
  return "other";
}

export class LlmHealthTracker {
  private attempts: LlmHealthAttempt[] = [];

  /**
   * Record a single LLM call. `ok: true` → success. `ok: false` with the raw
   * error message lets us classify billing/rate_limit/provider failures.
   */
  recordAttempt(ok: boolean, reason?: string): void {
    const attempt: LlmHealthAttempt = {
      timestamp: Date.now(),
      ok,
    };
    if (!ok) {
      attempt.reason = classifyError(reason);
    }
    this.attempts.push(attempt);
    if (this.attempts.length > RING_SIZE) {
      this.attempts.shift();
    }
  }

  snapshot(now: Date = new Date()): LlmHealthSnapshot {
    const nowMs = now.getTime();
    const windowStart = nowMs - WINDOW_MS;
    const recent = this.attempts.filter((a) => a.timestamp >= windowStart);
    const recentFailures = recent.filter((a) => !a.ok);

    const lastFail = [...this.attempts].reverse().find((a) => !a.ok);

    const snap: LlmHealthSnapshot = {
      recentAttempts: recent.length,
      recentFailures: recentFailures.length,
      status: this.computeStatus(recent, recentFailures.length),
    };
    if (lastFail) {
      snap.lastFailureIso = new Date(lastFail.timestamp).toISOString();
      snap.lastFailureReason = lastFail.reason;
    }
    return snap;
  }

  /**
   * Rule set (from spec):
   *   - last 3 attempts all failed → down
   *   - 3+ failures AND >50% of recent failed → degraded
   *   - otherwise → ok
   */
  private computeStatus(recent: LlmHealthAttempt[], failures: number): LlmHealthStatus {
    if (failures === 0) return "ok";
    if (recent.length >= 3) {
      const lastThree = recent.slice(-3);
      if (lastThree.every((a) => !a.ok)) return "down";
    }
    if (failures >= 3 && failures > recent.length / 2) return "degraded";
    return "ok";
  }

  /** Test hook — wipe state. Not for production use. */
  reset(): void {
    this.attempts = [];
  }
}

/** Process-wide singleton used by evaluator + session summarizer. */
export const llmHealthTracker = new LlmHealthTracker();
