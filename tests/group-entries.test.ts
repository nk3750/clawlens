// Tests for dashboard/src/lib/groupEntries.ts — describeEntry
// rewritten in homepage-bottom-row-spec §7 as a thin adapter over
// eventFormat primitives. Keep groupVerb, findCommonPath, groupEntries
// unchanged (not exhaustively retested here — no behavior change).

import { describe, expect, it } from "vitest";
import { describeEntry, groupVerb } from "../dashboard/src/lib/groupEntries";
import type { EntryResponse } from "../dashboard/src/lib/types";

function entry(partial: Partial<EntryResponse> = {}): EntryResponse {
  return {
    timestamp: "2026-04-24T12:00:00.000Z",
    toolName: "read",
    params: {},
    effectiveDecision: "allow",
    decision: "allow",
    category: "exploring",
    ...partial,
  };
}

describe("describeEntry — non-exec tools (Verb target)", () => {
  it("read with path", () => {
    expect(describeEntry(entry({ toolName: "read", params: { path: "/tmp/x" } }))).toBe(
      "Read /tmp/x",
    );
  });
  it("write with path", () => {
    expect(describeEntry(entry({ toolName: "write", params: { path: "/a" } }))).toBe("Wrote /a");
  });
  it("edit with path", () => {
    expect(describeEntry(entry({ toolName: "edit", params: { path: "/a" } }))).toBe("Edited /a");
  });
  it("read with no target falls back to the capitalised verb only", () => {
    expect(describeEntry(entry({ toolName: "read", params: {} }))).toBe("Read");
  });
  it("grep with pattern renders quoted target", () => {
    expect(describeEntry(entry({ toolName: "grep", params: { pattern: "TODO" } }))).toBe(
      'Searched "TODO"',
    );
  });
  it("web_fetch uses full url (no domain-only truncation)", () => {
    expect(
      describeEntry(
        entry({
          toolName: "web_fetch",
          params: { url: "https://example.com/deep/path" },
        }),
      ),
    ).toBe("Fetched https://example.com/deep/path");
  });
  it("message combines to + subject", () => {
    expect(
      describeEntry(
        entry({
          toolName: "message",
          params: { to: "#general", subject: "ship" },
        }),
      ),
    ).toBe('Sent #general: "ship"');
  });
  it("memory_get with no key renders the fallback target", () => {
    expect(describeEntry(entry({ toolName: "memory_get", params: {} }))).toBe(
      "Recalled (all memories)",
    );
  });
  it("unknown tool falls back to the raw tool name as verb", () => {
    expect(describeEntry(entry({ toolName: "custom_tool", params: {} }))).toBe("Custom_tool");
  });
});

describe("describeEntry — exec (Verb `primary target` with 40-char command truncation)", () => {
  it("renders with backticked primary + target", () => {
    expect(
      describeEntry(
        entry({
          toolName: "exec",
          execCategory: "git-read",
          params: { command: "git status" },
        }),
      ),
    ).toBe("Queried `git git status`");
  });
  it("truncates the target slice past 40 chars", () => {
    const longCmd = "python3 -m pip install --upgrade very-long-package-name-here-abc-def-ghi";
    const out = describeEntry(
      entry({
        toolName: "exec",
        execCategory: "scripting",
        params: { command: longCmd },
      }),
    );
    // target is sliced to 40 chars inside backticks
    expect(out.length).toBeLessThanOrEqual("Ran `python3 ".length + 40 + 1);
    expect(out.startsWith("Ran `python3 ")).toBe(true);
  });
  it("falls back when command is missing", () => {
    expect(describeEntry(entry({ toolName: "exec", execCategory: "unknown-exec" }))).toBe(
      "Ran command",
    );
  });
});

describe("describeEntry — decision override (block/timeout → Proposed)", () => {
  it('block → starts with "Proposed"', () => {
    expect(
      describeEntry(
        entry({
          toolName: "exec",
          execCategory: "destructive",
          params: { command: "rm -rf /" },
          effectiveDecision: "block",
        }),
      ).startsWith("Proposed"),
    ).toBe(true);
  });
  it('timeout → starts with "Proposed"', () => {
    expect(
      describeEntry(
        entry({
          toolName: "read",
          params: { path: "/a" },
          effectiveDecision: "timeout",
        }),
      ),
    ).toBe("Proposed /a");
  });
  it("pending keeps the base verb", () => {
    expect(
      describeEntry(
        entry({
          toolName: "read",
          params: { path: "/a" },
          effectiveDecision: "pending",
        }),
      ),
    ).toBe("Read /a");
  });
});

describe("groupVerb — unchanged (group-level semantic)", () => {
  it("read → Read/files", () => {
    expect(groupVerb("read")).toEqual({ verb: "Read", noun: "files" });
  });
  it("exec → Ran/commands", () => {
    expect(groupVerb("exec")).toEqual({ verb: "Ran", noun: "commands" });
  });
});
