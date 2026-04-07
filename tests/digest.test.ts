import { describe, expect, it } from "vitest";
import { generateDigest } from "../src/audit/digest";
import type { AuditEntry } from "../src/audit/logger";

function makeEntry(overrides: Partial<AuditEntry>): AuditEntry {
  return {
    timestamp: "2026-03-29T10:00:00Z",
    toolName: "read",
    params: {},
    decision: "allow",
    prevHash: "0",
    hash: "abc",
    ...overrides,
  };
}

describe("generateDigest", () => {
  const testDate = new Date("2026-03-29T18:00:00Z");

  it("generates summary with correct counts", () => {
    const entries: AuditEntry[] = [
      // Decision entries
      makeEntry({ toolName: "read", decision: "allow" }),
      makeEntry({ toolName: "read", decision: "allow" }),
      makeEntry({ toolName: "read", decision: "allow" }),
      makeEntry({
        toolName: "exec",
        decision: "block",
        policyRule: "Block rm -rf",
        params: { command: "rm -rf /" },
      }),
      makeEntry({ toolName: "exec", decision: "approval_required" }),
      // Resolution entry
      makeEntry({
        toolName: "exec",
        decision: "allow",
        userResponse: "approved",
      }),
    ];

    const digest = generateDigest(entries, testDate);

    expect(digest).toContain("ClawLens Daily Summary");
    expect(digest).toContain("March 29");
    // Decision entries: 3 allow + 1 block + 1 approval_required = 5
    // (resolution entry is filtered out because it has userResponse)
    expect(digest).toContain("5 tool call");
    expect(digest).toContain("3 auto-allowed");
    expect(digest).toContain("1 blocked by policy");
    expect(digest).toContain("1 approved by you");
    expect(digest).toContain("Block rm -rf");
    expect(digest).toContain("rm -rf /");
  });

  it("handles empty entries", () => {
    const digest = generateDigest([], testDate);
    expect(digest).toContain("No tool calls recorded today");
  });

  it("shows timeout entries", () => {
    const entries: AuditEntry[] = [
      makeEntry({ toolName: "exec", decision: "approval_required" }),
      makeEntry({
        toolName: "exec",
        decision: "block",
        userResponse: "timeout",
      }),
    ];

    const digest = generateDigest(entries, testDate);
    expect(digest).toContain("1 timed out (denied)");
  });

  it("includes 'No anomalies detected' footer", () => {
    const entries = [makeEntry({ decision: "allow" })];
    const digest = generateDigest(entries, testDate);
    expect(digest).toContain("No anomalies detected");
  });

  it("limits blocked/approved highlights to 5", () => {
    const entries: AuditEntry[] = [];
    for (let i = 0; i < 10; i++) {
      entries.push(
        makeEntry({
          toolName: "exec",
          decision: "block",
          policyRule: `Rule ${i}`,
          params: { command: `bad-cmd-${i}` },
          timestamp: `2026-03-29T${String(10 + i).padStart(2, "0")}:00:00Z`,
        }),
      );
    }

    const digest = generateDigest(entries, testDate);
    const blockedLines = digest.split("\n").filter((l) => l.startsWith("Blocked:"));
    expect(blockedLines).toHaveLength(5);
  });
});
