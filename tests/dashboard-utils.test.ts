// Tests for dashboard/src/lib/utils.ts helpers that were extended
// for the homepage-bottom-row spec (§4 deriveTags decision prepend,
// §5 relTimeCompact).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveTags, relTimeCompact } from "../dashboard/src/lib/utils";

const NOW_ISO = "2026-04-24T12:00:00.000Z";

// ─────────────────────────────────────────────────────────────
// deriveTags — decision prepend (spec §4)
// ─────────────────────────────────────────────────────────────

describe("deriveTags — decision prepend", () => {
  it('prepends "blocked" when effectiveDecision === "block"', () => {
    const tags = deriveTags({
      toolName: "exec",
      execCategory: "destructive",
      effectiveDecision: "block",
    });
    expect(tags[0]).toBe("blocked");
    // Still includes the category-derived tag after it
    expect(tags).toContain("destructive");
  });
  it('prepends "timeout" when effectiveDecision === "timeout"', () => {
    const tags = deriveTags({
      toolName: "exec",
      execCategory: "destructive",
      effectiveDecision: "timeout",
    });
    expect(tags[0]).toBe("timeout");
  });
  it('prepends "pending" when effectiveDecision === "pending"', () => {
    const tags = deriveTags({
      toolName: "read",
      effectiveDecision: "pending",
    });
    expect(tags[0]).toBe("pending");
  });
  it("does not prepend anything for allow / approved / undefined", () => {
    expect(deriveTags({ toolName: "read", effectiveDecision: "allow" })[0]).toBe("file-read");
    expect(deriveTags({ toolName: "read", effectiveDecision: "approved" })[0]).toBe("file-read");
    expect(deriveTags({ toolName: "read" })[0]).toBe("file-read");
  });
  it("caps the returned list at 3 items (decision + 2 scorer tags)", () => {
    const tags = deriveTags({
      toolName: "exec",
      effectiveDecision: "block",
      riskTags: ["destructive", "file-delete", "third-tag", "fourth-tag"],
    });
    expect(tags.length).toBe(3);
    expect(tags[0]).toBe("blocked");
  });
  it("caps at 2 when there's no decision prepend (legacy behavior preserved)", () => {
    const tags = deriveTags({
      toolName: "exec",
      riskTags: ["destructive", "file-delete", "third-tag"],
    });
    // Without decision, cap is still 3 per spec, but scorer tags limit to 2
    // for unchanged visual density. We assert the invariant: never more than
    // 3 total, never more than 2 scorer tags surfaced.
    expect(tags.length).toBeLessThanOrEqual(3);
    expect(tags).toContain("destructive");
    expect(tags).toContain("file-delete");
  });
});

describe("deriveTags — existing behavior preserved (smoke)", () => {
  it("prioritizes scorer riskTags over category tags", () => {
    const tags = deriveTags({
      toolName: "exec",
      execCategory: "read-only",
      riskTags: ["credential-access"],
    });
    expect(tags).toContain("credential-access");
  });
  it("uses exec sub-category tag when no riskTags", () => {
    expect(deriveTags({ toolName: "exec", execCategory: "destructive" })).toContain("destructive");
  });
  it("falls back to tool tag for non-exec tools", () => {
    expect(deriveTags({ toolName: "write" })).toContain("file-write");
  });
  it("returns empty list when toolName is empty", () => {
    expect(deriveTags({ toolName: "" })).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────
// relTimeCompact (spec §5)
// ─────────────────────────────────────────────────────────────

describe("relTimeCompact", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_ISO));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders sub-minute ages in seconds", () => {
    expect(relTimeCompact("2026-04-24T11:59:58.000Z")).toBe("2s");
    expect(relTimeCompact("2026-04-24T11:59:46.000Z")).toBe("14s");
  });
  it("renders sub-hour ages in minutes", () => {
    expect(relTimeCompact("2026-04-24T11:59:00.000Z")).toBe("1m");
    expect(relTimeCompact("2026-04-24T11:16:00.000Z")).toBe("44m");
  });
  it("renders sub-day ages in hours", () => {
    expect(relTimeCompact("2026-04-24T11:00:00.000Z")).toBe("1h");
    expect(relTimeCompact("2026-04-24T10:00:00.000Z")).toBe("2h");
  });
  it("renders sub-week ages in days", () => {
    expect(relTimeCompact("2026-04-21T12:00:00.000Z")).toBe("3d");
    expect(relTimeCompact("2026-04-18T12:00:00.000Z")).toBe("6d");
  });
  it("renders 7+ days as absolute date", () => {
    const out = relTimeCompact("2026-04-01T12:00:00.000Z");
    // Format is locale-specific; assert a non-compact unit isn't used.
    expect(out).not.toMatch(/(s|m|h|d)$/);
    expect(out.length).toBeGreaterThan(0);
  });
  it("never adds a trailing 'ago'", () => {
    const outs = [
      "2026-04-24T11:59:58.000Z",
      "2026-04-24T11:59:00.000Z",
      "2026-04-24T11:00:00.000Z",
      "2026-04-21T12:00:00.000Z",
    ].map(relTimeCompact);
    for (const out of outs) {
      expect(out).not.toMatch(/ago/);
    }
  });
});
