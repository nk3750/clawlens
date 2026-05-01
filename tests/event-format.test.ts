// Tests for dashboard/src/lib/eventFormat.ts
//
// Exhaustive coverage: every toolName in TOOL_TO_CATEGORY, every ExecCategory
// (15 values from src/risk/exec-parser.ts:9-24), and every decision override.
// Spec: docs/product/homepage-bottom-row-spec.md §1-§3.

import { describe, expect, it } from "vitest";
import { formatEventTarget, toolNamespace, verbFor } from "../dashboard/src/lib/eventFormat";
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

// ─────────────────────────────────────────────────────────────
// toolNamespace — spec §1
// ─────────────────────────────────────────────────────────────

describe("toolNamespace — exhaustive tool map", () => {
  const cases: Array<[string, string]> = [
    ["read", "fs.read"],
    ["write", "fs.write"],
    ["edit", "fs.edit"],
    ["find", "fs.find"],
    ["ls", "fs.ls"],
    ["grep", "fs.grep"],
    ["web_search", "web.search"],
    ["web_fetch", "net.fetch"],
    ["fetch_url", "net.fetch"],
    ["browser", "net.browser"],
    ["memory_get", "memory.get"],
    ["memory_search", "memory.search"],
    ["message", "comm.send"],
    ["sessions_spawn", "agent.spawn"],
    ["cron", "schedule.install"],
  ];
  for (const [toolName, expected] of cases) {
    it(`maps ${toolName} → ${expected}`, () => {
      expect(toolNamespace(entry({ toolName }))).toBe(expected);
    });
  }

  it("falls back to raw tool name for unknown tools", () => {
    expect(toolNamespace(entry({ toolName: "custom_tool" }))).toBe("custom_tool");
  });
});

describe("toolNamespace — exec (shell.{primaryCommand})", () => {
  it("extracts primaryCommand from a simple command", () => {
    expect(toolNamespace(entry({ toolName: "exec", params: { command: "git status" } }))).toBe(
      "shell.git",
    );
  });
  it("handles curl", () => {
    expect(
      toolNamespace(entry({ toolName: "exec", params: { command: "curl https://example.com" } })),
    ).toBe("shell.curl");
  });
  it("handles chained commands (skips cd prefix)", () => {
    expect(
      toolNamespace(
        entry({
          toolName: "exec",
          params: { command: "cd /tmp && ls -la" },
        }),
      ),
    ).toBe("shell.ls");
  });
  it("falls back to shell.exec when command is missing", () => {
    expect(toolNamespace(entry({ toolName: "exec", params: {} }))).toBe("shell.exec");
  });
  it("falls back to shell.exec when primaryCommand is empty (only prefixes)", () => {
    // `cd /tmp` alone has no primary command
    expect(toolNamespace(entry({ toolName: "exec", params: { command: "cd /tmp" } }))).toBe(
      "shell.exec",
    );
  });
});

describe("toolNamespace — process (process.{action})", () => {
  it("uses params.action when present", () => {
    expect(toolNamespace(entry({ toolName: "process", params: { action: "poll" } }))).toBe(
      "process.poll",
    );
  });
  it("falls back to process.op when action is missing", () => {
    expect(toolNamespace(entry({ toolName: "process", params: {} }))).toBe("process.op");
  });
});

// ─────────────────────────────────────────────────────────────
// verbFor — spec §2
// ─────────────────────────────────────────────────────────────

describe("verbFor — base tool verbs", () => {
  const cases: Array<[string, string]> = [
    ["read", "read"],
    ["write", "wrote"],
    ["edit", "edited"],
    ["find", "found"],
    ["ls", "listed"],
    ["grep", "searched"],
    ["web_search", "searched"],
    ["web_fetch", "fetched"],
    ["fetch_url", "fetched"],
    ["browser", "opened"],
    ["memory_get", "recalled"],
    ["memory_search", "searched"],
    ["message", "sent"],
    ["sessions_spawn", "spawned"],
    ["cron", "scheduled"],
  ];
  for (const [toolName, expected] of cases) {
    it(`${toolName} → "${expected}"`, () => {
      expect(verbFor(entry({ toolName }))).toBe(expected);
    });
  }

  it("falls back to the raw tool name for unknown tools", () => {
    expect(verbFor(entry({ toolName: "custom_tool" }))).toBe("custom_tool");
  });
});

describe("verbFor — process (verb = params.action lowercased)", () => {
  it("uses lowercased action", () => {
    expect(verbFor(entry({ toolName: "process", params: { action: "POLL" } }))).toBe("poll");
  });
  it("fallback to operated when action missing", () => {
    expect(verbFor(entry({ toolName: "process", params: {} }))).toBe("operated");
  });
});

describe("verbFor — exec (all 15 ExecCategory values)", () => {
  const cases: Array<[string, string]> = [
    ["read-only", "ran"],
    ["search", "searched"],
    ["system-info", "queried"],
    ["echo", "printed"],
    ["git-read", "queried"],
    ["git-write", "committed"],
    ["network-read", "fetched"],
    ["network-write", "posted"],
    ["scripting", "ran"],
    ["package-mgmt", "installed"],
    ["destructive", "ran"],
    ["permissions", "changed"],
    ["persistence", "installed"],
    ["remote", "connected"],
    ["unknown-exec", "ran"],
  ];
  for (const [execCategory, expected] of cases) {
    it(`${execCategory} → "${expected}"`, () => {
      expect(verbFor(entry({ toolName: "exec", execCategory }))).toBe(expected);
    });
  }
  it("defaults to unknown-exec verb when execCategory missing", () => {
    expect(verbFor(entry({ toolName: "exec" }))).toBe("ran");
  });
});

describe("verbFor — decision overrides (block/timeout → proposed)", () => {
  it('replaces base verb with "proposed" on block', () => {
    expect(verbFor(entry({ toolName: "read", effectiveDecision: "block" }))).toBe("proposed");
  });
  it('replaces base verb with "proposed" on timeout', () => {
    expect(verbFor(entry({ toolName: "write", effectiveDecision: "timeout" }))).toBe("proposed");
  });
  it('also overrides exec verbs with "proposed" on block', () => {
    expect(
      verbFor(
        entry({
          toolName: "exec",
          execCategory: "destructive",
          effectiveDecision: "block",
        }),
      ),
    ).toBe("proposed");
  });
  it("pending keeps the base verb (awaiting, not denied)", () => {
    expect(verbFor(entry({ toolName: "read", effectiveDecision: "pending" }))).toBe("read");
  });
  it("approved / allow keep the base verb", () => {
    expect(verbFor(entry({ toolName: "read", effectiveDecision: "approved" }))).toBe("read");
    expect(verbFor(entry({ toolName: "read", effectiveDecision: "allow" }))).toBe("read");
  });
});

// ─────────────────────────────────────────────────────────────
// formatEventTarget — spec §3
// ─────────────────────────────────────────────────────────────

describe("formatEventTarget — filesystem tools", () => {
  it("read uses params.path", () => {
    expect(formatEventTarget(entry({ toolName: "read", params: { path: "/etc/hosts" } }))).toBe(
      "/etc/hosts",
    );
  });
  it("read falls back to params.file_path when path missing", () => {
    expect(formatEventTarget(entry({ toolName: "read", params: { file_path: "/tmp/y" } }))).toBe(
      "/tmp/y",
    );
  });
  it("write uses params.path", () => {
    expect(formatEventTarget(entry({ toolName: "write", params: { path: "/a/b" } }))).toBe("/a/b");
  });
  it("edit uses params.path", () => {
    expect(formatEventTarget(entry({ toolName: "edit", params: { path: "/a/b" } }))).toBe("/a/b");
  });
  it("ls uses params.path (parallel to read/write/edit)", () => {
    expect(formatEventTarget(entry({ toolName: "ls", params: { path: "/Users/x/code" } }))).toBe(
      "/Users/x/code",
    );
  });
  it("ls empty when params missing", () => {
    expect(formatEventTarget(entry({ toolName: "ls", params: {} }))).toBe("");
  });
  it("read empty when params missing", () => {
    expect(formatEventTarget(entry({ toolName: "read", params: {} }))).toBe("");
  });
});

describe("formatEventTarget — pattern-based tools (find, grep)", () => {
  it("find quotes the pattern", () => {
    expect(formatEventTarget(entry({ toolName: "find", params: { pattern: "**/*.ts" } }))).toBe(
      '"**/*.ts"',
    );
  });
  it("grep quotes the pattern", () => {
    expect(formatEventTarget(entry({ toolName: "grep", params: { pattern: "TODO" } }))).toBe(
      '"TODO"',
    );
  });
  it("find empty when pattern missing", () => {
    expect(formatEventTarget(entry({ toolName: "find", params: {} }))).toBe("");
  });
});

describe("formatEventTarget — search-like tools (web_search, memory_search)", () => {
  it("web_search quotes the query", () => {
    expect(
      formatEventTarget(entry({ toolName: "web_search", params: { query: "typescript" } })),
    ).toBe('"typescript"');
  });
  it("memory_search quotes the query", () => {
    expect(
      formatEventTarget(entry({ toolName: "memory_search", params: { query: "recent" } })),
    ).toBe('"recent"');
  });
  it("bare search falls through to default empty (no longer routed)", () => {
    // pi-coding-agent never registered a `search` tool; the dead arm was
    // dropped so a hypothetical bare-search call returns "" via the
    // unknown-tool default branch.
    expect(formatEventTarget(entry({ toolName: "search", params: { query: "react" } }))).toBe("");
  });
});

describe("formatEventTarget — URL-based tools (web_fetch, fetch_url, browser)", () => {
  it("web_fetch uses full url", () => {
    expect(
      formatEventTarget(
        entry({
          toolName: "web_fetch",
          params: { url: "https://example.com/deep/path?q=1" },
        }),
      ),
    ).toBe("https://example.com/deep/path?q=1");
  });
  it("fetch_url uses full url", () => {
    expect(
      formatEventTarget(entry({ toolName: "fetch_url", params: { url: "https://x.com" } })),
    ).toBe("https://x.com");
  });
  it("browser uses full url", () => {
    expect(
      formatEventTarget(entry({ toolName: "browser", params: { url: "https://x.com" } })),
    ).toBe("https://x.com");
  });
});

describe("formatEventTarget — memory_get", () => {
  it("uses params.key when present", () => {
    expect(formatEventTarget(entry({ toolName: "memory_get", params: { key: "user.name" } }))).toBe(
      "user.name",
    );
  });
  it('falls back to "(all memories)" when key missing', () => {
    expect(formatEventTarget(entry({ toolName: "memory_get", params: {} }))).toBe("(all memories)");
  });
});

describe("formatEventTarget — message", () => {
  // Live params: {action, target, channel, caption, ...} — see issue #43.
  it("combines target + caption", () => {
    expect(
      formatEventTarget(
        entry({
          toolName: "message",
          params: { target: "#general", caption: "shipping" },
        }),
      ),
    ).toBe('#general: "shipping"');
  });
  it("target only when caption missing", () => {
    expect(formatEventTarget(entry({ toolName: "message", params: { target: "#general" } }))).toBe(
      "#general",
    );
  });
  it("caption only when target/channel missing", () => {
    expect(formatEventTarget(entry({ toolName: "message", params: { caption: "hi" } }))).toBe(
      '"hi"',
    );
  });
  it("falls back to channel when target missing", () => {
    expect(formatEventTarget(entry({ toolName: "message", params: { channel: "#ops" } }))).toBe(
      "#ops",
    );
  });
  it("prefers target over channel when both present", () => {
    expect(
      formatEventTarget(entry({ toolName: "message", params: { target: "#a", channel: "#b" } })),
    ).toBe("#a");
  });
  it("empty when target/channel/caption all missing", () => {
    expect(formatEventTarget(entry({ toolName: "message", params: {} }))).toBe("");
  });
});

describe("formatEventTarget — sessions_spawn / cron / process / exec", () => {
  it("sessions_spawn uses params.agent", () => {
    expect(
      formatEventTarget(
        entry({
          toolName: "sessions_spawn",
          params: { agent: "code-reviewer" },
        }),
      ),
    ).toBe("code-reviewer");
  });
  it("cron uses params.name", () => {
    expect(formatEventTarget(entry({ toolName: "cron", params: { name: "nightly" } }))).toBe(
      "nightly",
    );
  });
  it('cron falls back to "(unnamed)" when name missing', () => {
    expect(formatEventTarget(entry({ toolName: "cron", params: {} }))).toBe("(unnamed)");
  });
  // Live params: {action, sessionId, ...} — see issue #43.
  it("process uses params.sessionId", () => {
    expect(
      formatEventTarget(
        entry({
          toolName: "process",
          params: { sessionId: "s_abc", action: "poll" },
        }),
      ),
    ).toBe("s_abc");
  });
  it("process empty when sessionId missing (no phantom line 2)", () => {
    expect(formatEventTarget(entry({ toolName: "process", params: { action: "poll" } }))).toBe("");
  });
  it("exec uses full command, no truncation here", () => {
    const long = "git log --oneline --graph --decorate --all --since='2 weeks ago'";
    expect(formatEventTarget(entry({ toolName: "exec", params: { command: long } }))).toBe(long);
  });
});

describe("formatEventTarget — unknown tool", () => {
  it("returns empty string (no second line)", () => {
    expect(formatEventTarget(entry({ toolName: "custom_tool", params: { x: 1 } }))).toBe("");
  });
});
