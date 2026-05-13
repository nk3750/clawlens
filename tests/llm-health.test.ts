import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyError, LlmHealthTracker, llmHealthTracker } from "../src/audit/llm-health";

describe("classifyError", () => {
  it("recognises billing failures", () => {
    expect(classifyError("Your credit balance is too low")).toBe("billing");
    expect(classifyError("billing error: resolve at dashboard")).toBe("billing");
  });

  it("recognises rate-limit failures", () => {
    expect(classifyError("429 Too Many Requests")).toBe("rate_limit");
    expect(classifyError("hit the rate-limit")).toBe("rate_limit");
    expect(classifyError("rate limit exceeded")).toBe("rate_limit");
  });

  it("recognises provider 5xx failures", () => {
    expect(classifyError("503 Service Unavailable")).toBe("provider");
    expect(classifyError("HTTP 502 Bad Gateway")).toBe("provider");
  });

  it("falls back to 'other' for unknown messages", () => {
    expect(classifyError()).toBe("other");
    expect(classifyError("")).toBe("other");
    expect(classifyError("connection reset")).toBe("other");
  });

  // Issue #76: per-call signal for "modelAuth could not resolve a provider
  // key". The two exact call-site strings are:
  //   - src/dashboard/session-summary.ts:407 → "modelAuth: no api key"
  //   - src/risk/llm-evaluator.ts:341         → "modelAuth: no api key"
  // src/risk/llm-evaluator.ts:357 also passes the thrown err.message from
  // resolveApiKeyForProvider, whose error often contains "key resolution".
  it("recognises 'no_key' failures from modelAuth signals", () => {
    expect(classifyError("modelAuth: no api key")).toBe("no_key");
    expect(classifyError("modelAuth key resolution failed: timeout")).toBe("no_key");
    expect(classifyError("No API Key configured")).toBe("no_key");
    expect(classifyError("provider key resolution returned nothing")).toBe("no_key");
  });

  it("classifies 'no_key' BEFORE billing/rate_limit when one message contains both signals", () => {
    // A modelAuth failure that happens to mention 429 or billing must still
    // classify as no_key — the operator fix is "add a key", not "wait out a
    // rate limit" or "top up billing".
    expect(classifyError("modelAuth: no api key (request was rate-limited with 429)")).toBe(
      "no_key",
    );
    expect(classifyError("no api key — credit balance is too low")).toBe("no_key");
  });
});

describe("LlmHealthTracker", () => {
  let tracker: LlmHealthTracker;

  beforeEach(() => {
    tracker = new LlmHealthTracker();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-16T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports 'ok' when the tracker has no attempts", () => {
    expect(tracker.snapshot().status).toBe("ok");
    expect(tracker.snapshot().recentAttempts).toBe(0);
  });

  it("reports 'down' when the last 3 attempts in a row all failed", () => {
    tracker.recordAttempt(false, "credit balance too low");
    tracker.recordAttempt(false, "credit balance too low");
    tracker.recordAttempt(false, "credit balance too low");
    const snap = tracker.snapshot();
    expect(snap.status).toBe("down");
    expect(snap.recentFailures).toBe(3);
    expect(snap.lastFailureReason).toBe("billing");
    expect(snap.lastFailureIso).toBeDefined();
  });

  it("reports 'ok' when there is 1 failure in 10 attempts", () => {
    tracker.recordAttempt(false, "connection reset");
    for (let i = 0; i < 9; i++) tracker.recordAttempt(true);
    expect(tracker.snapshot().status).toBe("ok");
  });

  it("reports 'degraded' when 3+ failures are more than half of recent", () => {
    // 3 failures, 2 successes — interleaved so the last 3 aren't all failures
    tracker.recordAttempt(false, "429 rate limit");
    tracker.recordAttempt(true);
    tracker.recordAttempt(false, "429 rate limit");
    tracker.recordAttempt(true);
    tracker.recordAttempt(false, "429 rate limit");
    const snap = tracker.snapshot();
    expect(snap.status).toBe("degraded");
    expect(snap.lastFailureReason).toBe("rate_limit");
  });

  it("drops attempts older than the 15-minute window", () => {
    tracker.recordAttempt(false, "billing");
    tracker.recordAttempt(false, "billing");
    tracker.recordAttempt(false, "billing");
    expect(tracker.snapshot().status).toBe("down");

    // Jump 20 minutes forward — attempts fall out of the window
    vi.setSystemTime(new Date("2026-04-16T12:20:00Z"));
    const later = tracker.snapshot();
    expect(later.recentAttempts).toBe(0);
    expect(later.status).toBe("ok");
    // lastFailureIso is still reported from the ring buffer
    expect(later.lastFailureIso).toBeDefined();
  });

  it("exposes a singleton for shared use", () => {
    llmHealthTracker.reset();
    llmHealthTracker.recordAttempt(true);
    expect(llmHealthTracker.snapshot().recentAttempts).toBe(1);
    llmHealthTracker.reset();
    expect(llmHealthTracker.snapshot().recentAttempts).toBe(0);
  });

  it("caps the ring buffer so memory stays bounded", () => {
    for (let i = 0; i < 60; i++) tracker.recordAttempt(true);
    // Only the last 50 survive; snapshot should still report attempts from within the window
    const snap = tracker.snapshot();
    expect(snap.recentAttempts).toBeLessThanOrEqual(50);
  });
});
