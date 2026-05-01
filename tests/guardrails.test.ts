import { describe, expect, it } from "vitest";
import { extractIdentityKey, normalizeCommand, normalizeUrl } from "../src/guardrails/identity";

// Pure-function tests for the identity helpers. Store / hook / route /
// validator coverage lives in the dedicated guardrails-* test files (see
// guardrails-types, guardrails-extractors, guardrails-match,
// guardrails-store, guardrails-hook, guardrails-routes).

// ── Identity Key Extraction ──────────────────────────────────

describe("extractIdentityKey", () => {
  it("extracts command for exec tool", () => {
    expect(extractIdentityKey("exec", { command: "curl https://example.com" })).toBe(
      "curl https://example.com",
    );
  });

  // Process tool uses {action, sessionId} — no command field. See issue #43.
  it("extracts action:sessionId for process tool", () => {
    expect(extractIdentityKey("process", { action: "poll", sessionId: "s_abc" })).toBe(
      "poll:s_abc",
    );
  });

  it("extracts action: when sessionId missing for process tool", () => {
    expect(extractIdentityKey("process", { action: "poll" })).toBe("poll:");
  });

  it("extracts :sessionId when action missing for process tool", () => {
    expect(extractIdentityKey("process", { sessionId: "s_abc" })).toBe(":s_abc");
  });

  it("falls back to JSON for process tool when action+sessionId both missing", () => {
    expect(extractIdentityKey("process", { limit: 10 })).toBe('{"limit":10}');
  });

  it("differentiates two process calls with different sessionIds", () => {
    const k1 = extractIdentityKey("process", { action: "poll", sessionId: "s_a" });
    const k2 = extractIdentityKey("process", { action: "poll", sessionId: "s_b" });
    expect(k1).not.toBe(k2);
  });

  it("extracts path for read tool", () => {
    expect(extractIdentityKey("read", { path: "/etc/passwd" })).toBe("/etc/passwd");
  });

  it("extracts file_path for read tool (fallback)", () => {
    expect(extractIdentityKey("read", { file_path: "/etc/hosts" })).toBe("/etc/hosts");
  });

  it("prefers path over file_path for write tool", () => {
    expect(extractIdentityKey("write", { path: "/a", file_path: "/b" })).toBe("/a");
  });

  it("extracts path for edit tool", () => {
    expect(extractIdentityKey("edit", { path: "/src/main.ts" })).toBe("/src/main.ts");
  });

  it("extracts url for web_fetch tool", () => {
    expect(extractIdentityKey("web_fetch", { url: "https://api.example.com/data" })).toBe(
      "https://api.example.com/data",
    );
  });

  it("extracts url for fetch_url tool", () => {
    expect(extractIdentityKey("fetch_url", { url: "https://foo.com" })).toBe("https://foo.com");
  });

  it("extracts query for web_search tool", () => {
    expect(extractIdentityKey("web_search", { query: "node security" })).toBe("node security");
  });

  // pi-coding-agent never registered a bare `search` tool — that handler was
  // dead code. After #47, a `search` call falls through to the JSON-fallback
  // branch. Locks the dead arm out so a future re-add can't quietly resurrect
  // it without an explicit decision.
  it("regression: bare search tool falls through to JSON fallback (#47)", () => {
    expect(extractIdentityKey("search", { query: "find bugs" })).toBe('{"query":"find bugs"}');
  });

  // Browser tool uses {action, target, url} — sub-actions on the same URL must
  // not collapse to one identity. See issue #43.
  it("extracts action:url for browser tool", () => {
    expect(extractIdentityKey("browser", { action: "click", url: "https://app.com" })).toBe(
      "click:https://app.com",
    );
  });

  it("extracts action: for browser tool when url missing", () => {
    expect(extractIdentityKey("browser", { action: "click" })).toBe("click:");
  });

  it("extracts :url for browser tool when action missing", () => {
    expect(extractIdentityKey("browser", { url: "https://app.com" })).toBe(":https://app.com");
  });

  it("falls back to JSON for browser tool when action+url both missing", () => {
    expect(extractIdentityKey("browser", { foo: "bar" })).toBe('{"foo":"bar"}');
  });

  // Message tool uses {action, target, channel} — no `to` or `recipient`.
  // See issue #43.
  it("extracts action:target for message tool", () => {
    expect(extractIdentityKey("message", { action: "send", target: "#alerts" })).toBe(
      "send:#alerts",
    );
  });

  it("extracts action:channel for message tool when target missing", () => {
    expect(extractIdentityKey("message", { action: "send", channel: "#ops" })).toBe("send:#ops");
  });

  it("prefers target over channel for message tool when both present", () => {
    expect(extractIdentityKey("message", { action: "send", target: "#a", channel: "#b" })).toBe(
      "send:#a",
    );
  });

  it("falls back to JSON for message tool when action/target/channel all missing", () => {
    expect(extractIdentityKey("message", { caption: "hi" })).toBe('{"caption":"hi"}');
  });

  it("extracts sessionKey for sessions_spawn tool", () => {
    expect(extractIdentityKey("sessions_spawn", { sessionKey: "worker-1" })).toBe("worker-1");
  });

  it("extracts agent for sessions_spawn tool (fallback)", () => {
    expect(extractIdentityKey("sessions_spawn", { agent: "debugger" })).toBe("debugger");
  });

  it("extracts name:cron for cron tool", () => {
    expect(extractIdentityKey("cron", { name: "cleanup", cron: "0 0 * * *" })).toBe(
      "cleanup:0 0 * * *",
    );
  });

  it("extracts query for memory_search tool", () => {
    expect(extractIdentityKey("memory_search", { query: "api keys" })).toBe("api keys");
  });

  it("extracts key for memory_get tool", () => {
    expect(extractIdentityKey("memory_get", { key: "config.auth" })).toBe("config.auth");
  });

  // ── URL normalization in identity keys ───────────────────

  it("normalizes web_fetch URL: strips trailing slash", () => {
    expect(extractIdentityKey("web_fetch", { url: "https://apnews.com/" })).toBe(
      "https://apnews.com",
    );
  });

  it("normalizes web_fetch URL: lowercases protocol and hostname", () => {
    expect(extractIdentityKey("web_fetch", { url: "HTTPS://APNEWS.COM" })).toBe(
      "https://apnews.com",
    );
  });

  it("normalizes fetch_url URL: trailing slash + case", () => {
    expect(extractIdentityKey("fetch_url", { url: "HTTPS://FOO.COM/" })).toBe("https://foo.com");
  });

  it("normalizes browser URL: trailing slash + case (action prefix preserved)", () => {
    expect(extractIdentityKey("browser", { action: "click", url: "https://App.Com/" })).toBe(
      "click:https://app.com",
    );
  });

  it("normalizes URL: preserves path case", () => {
    expect(extractIdentityKey("web_fetch", { url: "https://example.com/MyPath/Page" })).toBe(
      "https://example.com/MyPath/Page",
    );
  });

  it("normalizes URL: strips fragment", () => {
    expect(extractIdentityKey("web_fetch", { url: "https://example.com/page#section" })).toBe(
      "https://example.com/page",
    );
  });

  it("normalizes URL: sorts query params", () => {
    expect(extractIdentityKey("web_fetch", { url: "https://example.com/api?z=1&a=2" })).toBe(
      "https://example.com/api?a=2&z=1",
    );
  });

  it("normalizes URL: strips default HTTPS port 443", () => {
    expect(extractIdentityKey("web_fetch", { url: "https://example.com:443/path" })).toBe(
      "https://example.com/path",
    );
  });

  it("normalizes URL: strips default HTTP port 80", () => {
    expect(extractIdentityKey("web_fetch", { url: "http://example.com:80/path" })).toBe(
      "http://example.com/path",
    );
  });

  it("normalizes URL: preserves non-default port", () => {
    expect(extractIdentityKey("web_fetch", { url: "https://example.com:8443/path" })).toBe(
      "https://example.com:8443/path",
    );
  });

  it("normalizes URL: non-URL string passes through unchanged", () => {
    expect(extractIdentityKey("web_fetch", { url: "not-a-url" })).toBe("not-a-url");
  });

  it("produces same key for equivalent URL variants", () => {
    const variants = [
      "https://apnews.com",
      "https://apnews.com/",
      "HTTPS://APNEWS.COM",
      "HTTPS://APNEWS.COM/",
      "https://apnews.com:443",
      "https://apnews.com:443/",
    ];
    const keys = variants.map((url) => extractIdentityKey("web_fetch", { url }));
    const unique = new Set(keys);
    expect(unique.size).toBe(1);
    expect(keys[0]).toBe("https://apnews.com");
  });

  // ── File path normalization in identity keys ────────────

  describe("file path normalization", () => {
    it("strips leading ./", () => {
      expect(extractIdentityKey("read", { path: "./src/main.ts" })).toBe("src/main.ts");
    });
    it("collapses double slashes", () => {
      expect(extractIdentityKey("write", { path: "src//main.ts" })).toBe("src/main.ts");
    });
    it("resolves . segments", () => {
      expect(extractIdentityKey("edit", { path: "src/./main.ts" })).toBe("src/main.ts");
    });
    it("resolves .. segments", () => {
      expect(extractIdentityKey("read", { path: "src/utils/../main.ts" })).toBe("src/main.ts");
    });
    it("strips trailing slash on file paths", () => {
      expect(extractIdentityKey("read", { path: "/etc/config/" })).toBe("/etc/config");
    });
    it("preserves absolute path root", () => {
      expect(extractIdentityKey("read", { path: "/etc/passwd" })).toBe("/etc/passwd");
    });
    it("normalizes file_path fallback too", () => {
      expect(extractIdentityKey("read", { file_path: "./src//index.ts" })).toBe("src/index.ts");
    });
    it("handles empty path", () => {
      expect(extractIdentityKey("read", { path: "" })).toBe("");
    });
  });

  // ── Command normalization in identity keys ──────────────

  describe("command normalization", () => {
    it("strips absolute path from primary command", () => {
      expect(extractIdentityKey("exec", { command: "/usr/bin/curl https://evil.com" })).toBe(
        "curl https://evil.com",
      );
    });
    it("strips env var prefixes", () => {
      expect(extractIdentityKey("exec", { command: "FOO=bar curl https://evil.com" })).toBe(
        "curl https://evil.com",
      );
    });
    it("strips env command prefix", () => {
      expect(extractIdentityKey("exec", { command: "env curl https://evil.com" })).toBe(
        "curl https://evil.com",
      );
    });
    it("strips sudo prefix", () => {
      expect(extractIdentityKey("exec", { command: "sudo rm -rf /tmp" })).toBe("rm -rf /tmp");
    });
    it("strips multiple prefixes (sudo env)", () => {
      expect(
        extractIdentityKey("exec", { command: "sudo env PATH=/x curl https://evil.com" }),
      ).toBe("curl https://evil.com");
    });
    it("still collapses whitespace", () => {
      expect(extractIdentityKey("exec", { command: "/usr/bin/curl   -s   https://evil.com" })).toBe(
        "curl -s https://evil.com",
      );
    });
    it("handles command with no path prefix", () => {
      expect(extractIdentityKey("exec", { command: "ls -la" })).toBe("ls -la");
    });
    it("handles empty command", () => {
      expect(extractIdentityKey("exec", { command: "" })).toBe("");
    });
  });

  it("returns sorted JSON for unknown tools", () => {
    const result = extractIdentityKey("unknown_tool", { b: 2, a: 1 });
    expect(result).toBe('{"a":1,"b":2}');
  });

  it("handles missing params gracefully", () => {
    expect(extractIdentityKey("exec", {})).toBe("");
    expect(extractIdentityKey("read", {})).toBe("");
    expect(extractIdentityKey("web_fetch", {})).toBe("");
    // process/message/browser fall through to the JSON default branch when
    // their identity-relevant keys are all missing — empty params hash to "{}".
    expect(extractIdentityKey("message", {})).toBe("{}");
    expect(extractIdentityKey("process", {})).toBe("{}");
    expect(extractIdentityKey("browser", {})).toBe("{}");
  });

  // ── Query/message/cron/spawn normalization ────────────────

  describe("query/message/cron/spawn normalization", () => {
    it("trims and lowercases web_search query", () => {
      expect(extractIdentityKey("web_search", { query: "  Node Security  " })).toBe(
        "node security",
      );
    });
    it("trims and lowercases memory_search query", () => {
      expect(extractIdentityKey("memory_search", { query: "  API Keys  " })).toBe("api keys");
    });
    it("trims and lowercases memory_get key", () => {
      expect(extractIdentityKey("memory_get", { key: " Config.Auth " })).toBe("config.auth");
    });
    it("trims cron name and normalizes cron expression whitespace", () => {
      expect(extractIdentityKey("cron", { name: " cleanup ", cron: "0  0  *  *  *" })).toBe(
        "cleanup:0 0 * * *",
      );
    });
    it("trims sessions_spawn key", () => {
      expect(extractIdentityKey("sessions_spawn", { sessionKey: " worker-1 " })).toBe("worker-1");
    });
  });

  // ── Find / grep / ls tool coverage ────────────────────────

  describe("find, grep, and ls tool coverage", () => {
    it("extracts pattern for find tool", () => {
      // pi-coding-agent registers `name: "find"` (find.js:72) — not `glob`.
      // Param shape is { pattern: "**/*.ext" }, identical to grep's.
      expect(extractIdentityKey("find", { pattern: "**/*.env" })).toBe("**/*.env");
    });
    it("extracts pattern for grep tool", () => {
      expect(extractIdentityKey("grep", { pattern: "API_KEY" })).toBe("API_KEY");
    });
    it("find ignores non-pattern params", () => {
      expect(extractIdentityKey("find", { pattern: "**/*.ts", path: "/app" })).toBe("**/*.ts");
      expect(extractIdentityKey("find", { pattern: "**/*.ts", limit: 10 })).toBe("**/*.ts");
    });
    it("extracts normalized path for ls tool", () => {
      expect(extractIdentityKey("ls", { path: "/Users/x/code" })).toBe("/Users/x/code");
    });
    it("ls normalizes path the same way read/write/edit do", () => {
      expect(extractIdentityKey("ls", { path: "./src//main" })).toBe("src/main");
    });
    it("ls returns empty when path missing", () => {
      expect(extractIdentityKey("ls", {})).toBe("");
    });
  });
});

describe("normalizeCommand", () => {
  it("collapses multiple whitespace to single space", () => {
    expect(normalizeCommand("curl   -s   https://example.com")).toBe("curl -s https://example.com");
  });

  it("trims leading and trailing whitespace", () => {
    expect(normalizeCommand("  ls -la  ")).toBe("ls -la");
  });

  it("normalizes tabs and newlines", () => {
    expect(normalizeCommand("echo\t'hello'\n")).toBe("echo 'hello'");
  });

  it("preserves single spaces", () => {
    expect(normalizeCommand("git status")).toBe("git status");
  });
});

describe("normalizeUrl", () => {
  it("strips trailing slash on bare domain", () => {
    expect(normalizeUrl("https://apnews.com/")).toBe("https://apnews.com");
  });

  it("lowercases protocol and hostname", () => {
    expect(normalizeUrl("HTTPS://APNEWS.COM")).toBe("https://apnews.com");
  });

  it("preserves path case", () => {
    expect(normalizeUrl("https://example.com/MyPath/Page")).toBe("https://example.com/MyPath/Page");
  });

  it("strips fragment", () => {
    expect(normalizeUrl("https://example.com/page#section")).toBe("https://example.com/page");
  });

  it("sorts query parameters", () => {
    expect(normalizeUrl("https://example.com/api?z=1&a=2")).toBe("https://example.com/api?a=2&z=1");
  });

  it("strips default HTTPS port 443", () => {
    expect(normalizeUrl("https://example.com:443/path")).toBe("https://example.com/path");
  });

  it("strips default HTTP port 80", () => {
    expect(normalizeUrl("http://example.com:80/path")).toBe("http://example.com/path");
  });

  it("preserves non-default port", () => {
    expect(normalizeUrl("https://example.com:8443/path")).toBe("https://example.com:8443/path");
  });

  it("returns non-URL strings unchanged", () => {
    expect(normalizeUrl("not-a-url")).toBe("not-a-url");
  });

  it("returns empty string unchanged", () => {
    expect(normalizeUrl("")).toBe("");
  });

  it("preserves trailing slash when path is not just /", () => {
    expect(normalizeUrl("https://example.com/docs/")).toBe("https://example.com/docs/");
  });

  it("keeps query params with trailing-slash-only path", () => {
    expect(normalizeUrl("https://example.com/?q=hello")).toBe("https://example.com/?q=hello");
  });

  it("strips credentials from URL", () => {
    expect(normalizeUrl("https://user:pass@evil.com/path")).toBe("https://evil.com/path");
  });

  it("strips surrounding whitespace from URL", () => {
    expect(normalizeUrl("  https://example.com/  ")).toBe("https://example.com");
  });
});
