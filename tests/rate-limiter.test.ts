import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { RateLimiter } from "../src/rate/limiter";

describe("RateLimiter", () => {
  let tmpDir: string;
  let statePath: string;
  let limiter: RateLimiter;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawclip-rate-test-"));
    statePath = path.join(tmpDir, "rate-state.json");
    limiter = new RateLimiter(statePath);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("starts with zero counts", () => {
    expect(limiter.getCount("exec", "test-rule", 3600)).toBe(0);
  });

  it("records and counts actions", () => {
    limiter.record("exec", "test-rule");
    limiter.record("exec", "test-rule");
    limiter.record("exec", "test-rule");

    expect(limiter.getCount("exec", "test-rule", 3600)).toBe(3);
  });

  it("counts only within sliding window", () => {
    limiter.record("exec", "test-rule");

    // Count with a long window should include the just-recorded action
    expect(limiter.getCount("exec", "test-rule", 3600)).toBe(1);

    // Count with a zero-second window should not include it
    expect(limiter.getCount("exec", "test-rule", 0)).toBe(0);
  });

  it("tracks different tools independently", () => {
    limiter.record("exec", "rule-a");
    limiter.record("exec", "rule-a");
    limiter.record("read", "rule-b");

    expect(limiter.getCount("exec", "rule-a", 3600)).toBe(2);
    expect(limiter.getCount("read", "rule-b", 3600)).toBe(1);
    expect(limiter.getCount("write", "rule-c", 3600)).toBe(0);
  });

  it("persists and restores state", () => {
    limiter.record("exec", "rule-a");
    limiter.record("exec", "rule-a");
    limiter.persist();

    const limiter2 = new RateLimiter(statePath);
    limiter2.restore();

    expect(limiter2.getCount("exec", "rule-a", 3600)).toBe(2);
  });

  it("starts fresh on corrupted state file", () => {
    fs.writeFileSync(statePath, "not valid json");
    const limiter2 = new RateLimiter(statePath);
    limiter2.restore();

    expect(limiter2.getCount("exec", "rule-a", 3600)).toBe(0);
  });

  it("cleans up expired entries", () => {
    // Record an action
    limiter.record("exec", "rule-a");
    expect(limiter.getCount("exec", "rule-a", 3600)).toBe(1);

    // Cleanup with default 24h window shouldn't remove recent entries
    limiter.cleanup();
    expect(limiter.getCount("exec", "rule-a", 3600)).toBe(1);
  });
});
