import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  extractIdentityKey,
  lookupKey,
  normalizeCommand,
  normalizeUrl,
} from "../src/guardrails/identity";
import { GuardrailStore } from "../src/guardrails/store";
import type { Guardrail } from "../src/guardrails/types";
import { isValidGuardrailAction } from "../src/guardrails/types";

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

describe("lookupKey", () => {
  it("creates composite key", () => {
    expect(lookupKey("agent-1", "exec", "ls -la")).toBe("agent-1:exec:ls -la");
  });

  it("uses * for global", () => {
    expect(lookupKey("*", "write", "/etc/passwd")).toBe("*:write:/etc/passwd");
  });

  // Regression for issue #43: two distinct process calls on the same agent
  // must not collapse to the same composite lookup key.
  it("produces distinct lookup keys for two distinct process calls", () => {
    const k1 = lookupKey(
      "a-1",
      "process",
      extractIdentityKey("process", { action: "poll", sessionId: "s_a" }),
    );
    const k2 = lookupKey(
      "a-1",
      "process",
      extractIdentityKey("process", { action: "poll", sessionId: "s_b" }),
    );
    expect(k1).not.toBe(k2);
  });
});

// ── GuardrailStore ───────────────────────────────────────────

describe("GuardrailStore", () => {
  let tmpDir: string;
  let filePath: string;
  let store: GuardrailStore;

  function makeGuardrail(overrides?: Partial<Guardrail>): Guardrail {
    return {
      id: GuardrailStore.generateId(),
      tool: "exec",
      identityKey: "curl https://example.com",
      matchMode: "exact",
      action: { type: "block" },
      agentId: "test-agent",
      createdAt: new Date().toISOString(),
      source: {
        toolCallId: "tc-001",
        sessionKey: "sess-001",
        agentId: "test-agent",
      },
      description: "exec — curl https://example.com",
      riskScore: 55,
      ...overrides,
    };
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawlens-test-"));
    filePath = path.join(tmpDir, "guardrails.json");
    store = new GuardrailStore(filePath);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("load() handles missing file gracefully", () => {
    store.load();
    expect(store.list()).toEqual([]);
  });

  it("add() persists to disk", () => {
    store.load();
    const g = makeGuardrail();
    store.add(g);

    // Verify file exists
    expect(fs.existsSync(filePath)).toBe(true);
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(data.version).toBe(1);
    expect(data.guardrails).toHaveLength(1);
    expect(data.guardrails[0].id).toBe(g.id);
  });

  it("load() recovers from disk", () => {
    store.load();
    const g = makeGuardrail();
    store.add(g);

    // Create new store instance and load
    const store2 = new GuardrailStore(filePath);
    store2.load();
    expect(store2.list()).toHaveLength(1);
    expect(store2.list()[0].id).toBe(g.id);
  });

  it("remove() removes by ID", () => {
    store.load();
    const g = makeGuardrail();
    store.add(g);
    expect(store.remove(g.id)).toBe(true);
    expect(store.list()).toHaveLength(0);
  });

  it("remove() returns false for unknown ID", () => {
    store.load();
    expect(store.remove("nonexistent")).toBe(false);
  });

  it("update() patches guardrail fields", () => {
    store.load();
    const g = makeGuardrail();
    store.add(g);

    const updated = store.update(g.id, { action: { type: "require_approval" } });
    expect(updated?.action.type).toBe("require_approval");
  });

  it("update() returns null for unknown ID", () => {
    store.load();
    expect(store.update("nonexistent", {})).toBeNull();
  });

  describe("match()", () => {
    it("matches agent-specific guardrail", () => {
      store.load();
      const g = makeGuardrail({ agentId: "agent-1" });
      store.add(g);

      const result = store.match("agent-1", "exec", "curl https://example.com");
      expect(result?.id).toBe(g.id);
    });

    it("does not match different agent", () => {
      store.load();
      store.add(makeGuardrail({ agentId: "agent-1" }));

      const result = store.match("agent-2", "exec", "curl https://example.com");
      expect(result).toBeNull();
    });

    it("matches global guardrail (agentId: null)", () => {
      store.load();
      const g = makeGuardrail({ agentId: null });
      store.add(g);

      const result = store.match("any-agent", "exec", "curl https://example.com");
      expect(result?.id).toBe(g.id);
    });

    it("prefers agent-specific over global", () => {
      store.load();
      const global = makeGuardrail({ agentId: null, action: { type: "block" } });
      const specific = makeGuardrail({ agentId: "agent-1", action: { type: "require_approval" } });
      store.add(global);
      store.add(specific);

      const result = store.match("agent-1", "exec", "curl https://example.com");
      expect(result?.action.type).toBe("require_approval");
    });

    it("returns null for non-matching identity key", () => {
      store.load();
      store.add(makeGuardrail());

      const result = store.match("test-agent", "exec", "different command");
      expect(result).toBeNull();
    });

    it("returns null for non-matching tool", () => {
      store.load();
      store.add(makeGuardrail());

      const result = store.match("test-agent", "read", "curl https://example.com");
      expect(result).toBeNull();
    });
  });

  describe("peek()", () => {
    it("returns matching guardrail without side effects", () => {
      store.load();
      const g = makeGuardrail({ action: { type: "require_approval" } });
      store.add(g);

      const result = store.peek("test-agent", "exec", "curl https://example.com");
      expect(result?.id).toBe(g.id);
      expect(store.list()).toHaveLength(1);
    });

    it("returns null when no match", () => {
      store.load();
      store.add(makeGuardrail());

      const result = store.peek("test-agent", "exec", "different command");
      expect(result).toBeNull();
    });
  });

  it("list() filters by agentId", () => {
    store.load();
    store.add(makeGuardrail({ agentId: "a" }));
    store.add(makeGuardrail({ agentId: "b" }));
    store.add(makeGuardrail({ agentId: null }));

    const filtered = store.list({ agentId: "a" });
    // agent "a" + global (null)
    expect(filtered).toHaveLength(2);
  });

  it("lookup key handles identity keys containing colons", () => {
    store.load();
    const g = makeGuardrail({
      tool: "web_fetch",
      identityKey: "https://evil.com:8080/path",
      agentId: "agent-1",
    });
    store.add(g);

    const result = store.match("agent-1", "web_fetch", "https://evil.com:8080/path");
    expect(result?.id).toBe(g.id);
  });

  it("generateId() produces prefixed IDs", () => {
    const id = GuardrailStore.generateId();
    expect(id).toMatch(/^gr_[a-f0-9]{12}$/);
  });

  it("atomic save — tmp file is cleaned up", () => {
    store.load();
    store.add(makeGuardrail());

    // After save, no .tmp file should remain
    expect(fs.existsSync(`${filePath}.tmp`)).toBe(false);
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it("load() handles corrupted file gracefully", () => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "not json at all");

    store.load();
    expect(store.list()).toEqual([]);
  });

  it("load() migration filters out allow_once and allow_hours guardrails", () => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const data = {
      version: 1,
      guardrails: [
        {
          id: "gr_keep1",
          tool: "exec",
          identityKey: "cmd1",
          matchMode: "exact",
          action: { type: "block" },
          agentId: "a",
          createdAt: "2026-01-01T00:00:00Z",
          expiresAt: null,
          source: { toolCallId: "tc1", sessionKey: "s1", agentId: "a" },
          description: "exec — cmd1",
          riskScore: 50,
        },
        {
          id: "gr_remove1",
          tool: "exec",
          identityKey: "cmd2",
          matchMode: "exact",
          action: { type: "allow_once" },
          agentId: "a",
          createdAt: "2026-01-01T00:00:00Z",
          expiresAt: null,
          source: { toolCallId: "tc2", sessionKey: "s1", agentId: "a" },
          description: "exec — cmd2",
          riskScore: 10,
        },
        {
          id: "gr_remove2",
          tool: "exec",
          identityKey: "cmd3",
          matchMode: "exact",
          action: { type: "allow_hours", hours: 24 },
          agentId: "a",
          createdAt: "2026-01-01T00:00:00Z",
          expiresAt: "2026-01-02T00:00:00Z",
          source: { toolCallId: "tc3", sessionKey: "s1", agentId: "a" },
          description: "exec — cmd3",
          riskScore: 20,
        },
        {
          id: "gr_keep2",
          tool: "exec",
          identityKey: "cmd4",
          matchMode: "exact",
          action: { type: "require_approval" },
          agentId: null,
          createdAt: "2026-01-01T00:00:00Z",
          expiresAt: null,
          source: { toolCallId: "tc4", sessionKey: "s1", agentId: "a" },
          description: "exec — cmd4",
          riskScore: 60,
        },
      ],
    };
    fs.writeFileSync(filePath, JSON.stringify(data));

    store.load();
    expect(store.list()).toHaveLength(2);
    expect(
      store
        .list()
        .map((g) => g.id)
        .sort(),
    ).toEqual(["gr_keep1", "gr_keep2"]);

    // Verify cleaned file was saved
    const saved = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(saved.guardrails).toHaveLength(2);
  });
});

// ── GuardrailStore atomic write resilience (Phase 2.8 backport) ──────
// Mirrors src/risk/saved-searches-store.ts rollback semantics: if save()
// throws (ENOSPC, EISDIR, EROFS, EDQUOT, perms), in-memory state must roll
// back so it never diverges from disk. For a security-boundary store like
// guardrails, divergence is worse than for UI state — a phantom guardrail
// could match live tool calls until the next gateway restart.
//
// We provoke a real EISDIR by pre-creating a directory at the temp-write
// path; vitest's ESM module-namespace lock prevents spying on fs directly.

describe("GuardrailStore — atomic write resilience", () => {
  let tmpDir: string;
  let filePath: string;
  let store: GuardrailStore;

  function makeGuardrail(overrides?: Partial<Guardrail>): Guardrail {
    return {
      id: GuardrailStore.generateId(),
      tool: "exec",
      identityKey: "curl https://example.com",
      matchMode: "exact",
      action: { type: "block" },
      agentId: "alpha",
      createdAt: new Date().toISOString(),
      source: { toolCallId: "tc-001", sessionKey: "sess-001", agentId: "alpha" },
      description: "exec — curl https://example.com",
      riskScore: 55,
      ...overrides,
    };
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawlens-gr-rollback-"));
    filePath = path.join(tmpDir, "guardrails.json");
    store = new GuardrailStore(filePath);
    store.load();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("add() rolls back the in-memory push when save() throws — list and disk both reflect only the survivor", () => {
    const survivor = makeGuardrail({ identityKey: "survivor" });
    store.add(survivor);
    expect(store.list()).toHaveLength(1);

    const tmpPath = `${filePath}.tmp`;
    fs.mkdirSync(tmpPath); // writeFileSync(tmpPath, …) now throws EISDIR
    try {
      expect(() => store.add(makeGuardrail({ identityKey: "doomed" }))).toThrow();
    } finally {
      fs.rmdirSync(tmpPath);
    }

    expect(store.list()).toHaveLength(1);
    expect(store.list()[0].identityKey).toBe("survivor");

    // The doomed entry must not be reachable through the index either —
    // otherwise match()/peek() would return a phantom guardrail until the
    // next restart.
    expect(store.findExact("alpha", "exec", "doomed")).toBeNull();
    expect(store.findExact("alpha", "exec", "survivor")).not.toBeNull();

    // Disk and memory match.
    const reload = new GuardrailStore(filePath);
    reload.load();
    expect(reload.list()).toHaveLength(1);
    expect(reload.list()[0].identityKey).toBe("survivor");
  });

  it("remove() rolls back the splice and the index when save() throws", () => {
    const a = makeGuardrail({ identityKey: "a" });
    const b = makeGuardrail({ identityKey: "b" });
    store.add(a);
    store.add(b);

    const tmpPath = `${filePath}.tmp`;
    fs.mkdirSync(tmpPath);
    try {
      expect(() => store.remove(a.id)).toThrow();
    } finally {
      fs.rmdirSync(tmpPath);
    }

    expect(store.list()).toHaveLength(2);
    // Insertion order preserved — list() returns a fresh copy, but the
    // restored splice must put 'a' back at its original position.
    expect(store.list().map((g) => g.identityKey)).toEqual(["a", "b"]);

    // Index must be rebuilt — both entries reachable via findExact.
    expect(store.findExact("alpha", "exec", "a")).not.toBeNull();
    expect(store.findExact("alpha", "exec", "b")).not.toBeNull();

    const reload = new GuardrailStore(filePath);
    reload.load();
    expect(reload.list()).toHaveLength(2);
  });

  it("update() rolls back action AND agentId mutations when save() throws", () => {
    const g = makeGuardrail({ identityKey: "u", action: { type: "block" }, agentId: "alpha" });
    store.add(g);

    const tmpPath = `${filePath}.tmp`;
    fs.mkdirSync(tmpPath);
    try {
      expect(() =>
        store.update(g.id, { action: { type: "require_approval" }, agentId: "beta" }),
      ).toThrow();
    } finally {
      fs.rmdirSync(tmpPath);
    }

    // Both fields restored to their pre-update values.
    const after = store.list()[0];
    expect(after.action.type).toBe("block");
    expect(after.agentId).toBe("alpha");

    // Index restored: original (alpha, …) hits, attempted (beta, …) does not.
    expect(store.findExact("alpha", "exec", "u")).not.toBeNull();
    expect(store.findExact("beta", "exec", "u")).toBeNull();

    const reload = new GuardrailStore(filePath);
    reload.load();
    expect(reload.list()[0].action.type).toBe("block");
    expect(reload.list()[0].agentId).toBe("alpha");
  });
});

// ── before_tool_call guardrail enforcement ───────────────────

vi.mock("../src/risk/scorer", () => ({
  computeRiskScore: vi.fn(),
}));

vi.mock("../src/risk/llm-evaluator", () => ({
  evaluateWithLlm: vi.fn(),
}));

vi.mock("../src/alerts/telegram", () => ({
  shouldAlert: vi.fn().mockReturnValue(false),
  formatAlert: vi.fn().mockReturnValue("alert"),
  sendAlert: vi.fn(),
}));

import { DEFAULT_CONFIG } from "../src/config";
import { createBeforeToolCallHandler } from "../src/hooks/before-tool-call";
import { computeRiskScore } from "../src/risk/scorer";
import { SessionContext } from "../src/risk/session-context";

const mockComputeRiskScore = vi.mocked(computeRiskScore);

describe("before_tool_call guardrail enforcement", () => {
  function mockAuditLogger() {
    return {
      logDecision: vi.fn(),
      appendEvaluation: vi.fn(),
      logApprovalResolution: vi.fn(),
      logGuardrailMatch: vi.fn(),
      logGuardrailResolution: vi.fn(),
      init: vi.fn(),
      readEntries: vi.fn().mockReturnValue([]),
      flush: vi.fn(),
    };
  }

  function lowRisk() {
    return {
      score: 20,
      tier: "low" as const,
      tags: ["read-only"],
      breakdown: { base: 20, modifiers: [] },
      needsLlmEval: false,
    };
  }

  const ctx = { sessionKey: "test-session", agentId: "test-agent" };

  beforeEach(() => {
    vi.clearAllMocks();
    mockComputeRiskScore.mockReturnValue(lowRisk());
  });

  it("blocks when guardrail action is 'block'", async () => {
    const auditLogger = mockAuditLogger();
    const grStore = new GuardrailStore(path.join(os.tmpdir(), `gr-test-${Date.now()}.json`));
    grStore.load();
    grStore.add({
      id: "gr_test1",
      tool: "exec",
      identityKey: "curl https://evil.com",
      matchMode: "exact",
      action: { type: "block" },
      agentId: "test-agent",
      createdAt: new Date().toISOString(),
      source: { toolCallId: "tc-orig", sessionKey: "s1", agentId: "test-agent" },
      description: "exec — curl https://evil.com",
      riskScore: 80,
    });

    const handler = createBeforeToolCallHandler({
      auditLogger: auditLogger as never,
      config: { ...DEFAULT_CONFIG, guardrailsPath: "" },
      sessionContext: new SessionContext(),
      guardrailStore: grStore,
    });

    const result = await handler(
      { toolName: "exec", params: { command: "curl https://evil.com" }, toolCallId: "tc-002" },
      ctx,
    );

    expect(result?.block).toBe(true);
    expect(result?.blockReason).toContain("blocked");
    expect(auditLogger.logGuardrailMatch).toHaveBeenCalledOnce();
    // Risk scoring runs eagerly — pure + fast — so the guardrail-match audit
    // row carries the action's score. Closes the dashboard's risk-mix bar gap
    // where guardrail-blocked rows counted in todayToolCalls but vanished from
    // todayRiskMix. The score is captured on the audit row; the guardrail
    // still short-circuits before LLM eval.
    expect(mockComputeRiskScore).toHaveBeenCalledTimes(1);
    expect(auditLogger.logGuardrailMatch).toHaveBeenCalledWith(
      expect.objectContaining({ riskScore: expect.any(Number) }),
    );
  });

  it("returns requireApproval when guardrail action is 'require_approval'", async () => {
    const auditLogger = mockAuditLogger();
    const grStore = new GuardrailStore(path.join(os.tmpdir(), `gr-test-${Date.now()}.json`));
    grStore.load();
    grStore.add({
      id: "gr_test2",
      tool: "exec",
      identityKey: "rm -rf /tmp/data",
      matchMode: "exact",
      action: { type: "require_approval" },
      agentId: "test-agent",
      createdAt: new Date().toISOString(),
      source: { toolCallId: "tc-orig", sessionKey: "s1", agentId: "test-agent" },
      description: "exec — rm -rf /tmp/data",
      riskScore: 90,
    });

    const handler = createBeforeToolCallHandler({
      auditLogger: auditLogger as never,
      config: { ...DEFAULT_CONFIG, guardrailsPath: "" },
      sessionContext: new SessionContext(),
      guardrailStore: grStore,
    });

    const result = await handler(
      { toolName: "exec", params: { command: "rm -rf /tmp/data" }, toolCallId: "tc-003" },
      ctx,
    );

    expect(result?.requireApproval).toBeDefined();
    expect(result?.requireApproval?.title).toBe("ClawLens Guardrail");
    expect(result?.requireApproval?.severity).toBe("warning");
    expect(result?.requireApproval?.timeoutBehavior).toBe("deny");
    expect(auditLogger.logGuardrailMatch).toHaveBeenCalledOnce();
  });

  it("passes through when no guardrail matches", async () => {
    const auditLogger = mockAuditLogger();
    const grStore = new GuardrailStore(path.join(os.tmpdir(), `gr-test-${Date.now()}.json`));
    grStore.load();

    const handler = createBeforeToolCallHandler({
      auditLogger: auditLogger as never,
      config: { ...DEFAULT_CONFIG, guardrailsPath: "" },
      sessionContext: new SessionContext(),
      guardrailStore: grStore,
    });

    const result = await handler(
      { toolName: "exec", params: { command: "echo hello" }, toolCallId: "tc-005" },
      ctx,
    );

    expect(result).toBeUndefined();
    expect(mockComputeRiskScore).toHaveBeenCalledOnce();
    expect(auditLogger.logGuardrailMatch).not.toHaveBeenCalled();
  });

  it("works without guardrailStore (backward compatible)", async () => {
    const auditLogger = mockAuditLogger();
    const handler = createBeforeToolCallHandler({
      auditLogger: auditLogger as never,
      config: { ...DEFAULT_CONFIG, guardrailsPath: "" },
      sessionContext: new SessionContext(),
      // no guardrailStore
    });

    const result = await handler(
      { toolName: "exec", params: { command: "echo hello" }, toolCallId: "tc-006" },
      ctx,
    );

    expect(result).toBeUndefined();
    expect(mockComputeRiskScore).toHaveBeenCalledOnce();
  });

  it("allow-always resolution removes guardrail from store", async () => {
    const auditLogger = mockAuditLogger();
    const grStore = new GuardrailStore(path.join(os.tmpdir(), `gr-test-${Date.now()}.json`));
    grStore.load();
    grStore.add({
      id: "gr_allow_always",
      tool: "exec",
      identityKey: "safe-cmd",
      matchMode: "exact",
      action: { type: "require_approval" },
      agentId: "test-agent",
      createdAt: new Date().toISOString(),
      source: { toolCallId: "tc-orig", sessionKey: "s1", agentId: "test-agent" },
      description: "exec — safe-cmd",
      riskScore: 50,
    });

    const handler = createBeforeToolCallHandler({
      auditLogger: auditLogger as never,
      config: { ...DEFAULT_CONFIG, guardrailsPath: "" },
      sessionContext: new SessionContext(),
      guardrailStore: grStore,
    });

    const result = await handler(
      { toolName: "exec", params: { command: "safe-cmd" }, toolCallId: "tc-aa" },
      ctx,
    );

    result?.requireApproval?.onResolution?.("allow-always");

    expect(grStore.list()).toHaveLength(0);
    expect(auditLogger.logGuardrailResolution).toHaveBeenCalledWith(
      expect.objectContaining({
        guardrailId: "gr_allow_always",
        approved: true,
        decision: "allow-always",
        storeAction: "removed",
      }),
    );
  });

  it("allow-once resolution leaves guardrail unchanged", async () => {
    const auditLogger = mockAuditLogger();
    const grStore = new GuardrailStore(path.join(os.tmpdir(), `gr-test-ao-${Date.now()}.json`));
    grStore.load();
    grStore.add({
      id: "gr_allow_once",
      tool: "exec",
      identityKey: "maybe-cmd",
      matchMode: "exact",
      action: { type: "require_approval" },
      agentId: "test-agent",
      createdAt: new Date().toISOString(),
      source: { toolCallId: "tc-orig", sessionKey: "s1", agentId: "test-agent" },
      description: "exec — maybe-cmd",
      riskScore: 50,
    });

    const handler = createBeforeToolCallHandler({
      auditLogger: auditLogger as never,
      config: { ...DEFAULT_CONFIG, guardrailsPath: "" },
      sessionContext: new SessionContext(),
      guardrailStore: grStore,
    });

    const result = await handler(
      { toolName: "exec", params: { command: "maybe-cmd" }, toolCallId: "tc-ao" },
      ctx,
    );

    result?.requireApproval?.onResolution?.("allow-once");

    expect(grStore.list()).toHaveLength(1);
    expect(auditLogger.logGuardrailResolution).toHaveBeenCalledWith(
      expect.objectContaining({
        approved: true,
        decision: "allow-once",
        storeAction: "unchanged",
      }),
    );
  });

  it("deny resolution leaves guardrail unchanged", async () => {
    const auditLogger = mockAuditLogger();
    const grStore = new GuardrailStore(path.join(os.tmpdir(), `gr-test-deny-${Date.now()}.json`));
    grStore.load();
    grStore.add({
      id: "gr_deny",
      tool: "exec",
      identityKey: "risky-cmd",
      matchMode: "exact",
      action: { type: "require_approval" },
      agentId: "test-agent",
      createdAt: new Date().toISOString(),
      source: { toolCallId: "tc-orig", sessionKey: "s1", agentId: "test-agent" },
      description: "exec — risky-cmd",
      riskScore: 70,
    });

    const handler = createBeforeToolCallHandler({
      auditLogger: auditLogger as never,
      config: { ...DEFAULT_CONFIG, guardrailsPath: "" },
      sessionContext: new SessionContext(),
      guardrailStore: grStore,
    });

    const result = await handler(
      { toolName: "exec", params: { command: "risky-cmd" }, toolCallId: "tc-deny" },
      ctx,
    );

    result?.requireApproval?.onResolution?.("deny");

    expect(grStore.list()).toHaveLength(1);
    expect(auditLogger.logGuardrailResolution).toHaveBeenCalledWith(
      expect.objectContaining({
        approved: false,
        decision: "deny",
        storeAction: "unchanged",
      }),
    );
  });

  it("storeAction field is logged in audit entry", async () => {
    const auditLogger = mockAuditLogger();
    const grStore = new GuardrailStore(path.join(os.tmpdir(), `gr-test-${Date.now()}.json`));
    grStore.load();
    grStore.add({
      id: "gr_audit",
      tool: "exec",
      identityKey: "audit-cmd",
      matchMode: "exact",
      action: { type: "require_approval" },
      agentId: "test-agent",
      createdAt: new Date().toISOString(),
      source: { toolCallId: "tc-orig", sessionKey: "s1", agentId: "test-agent" },
      description: "exec — audit-cmd",
      riskScore: 60,
    });

    const handler = createBeforeToolCallHandler({
      auditLogger: auditLogger as never,
      config: { ...DEFAULT_CONFIG, guardrailsPath: "" },
      sessionContext: new SessionContext(),
      guardrailStore: grStore,
    });

    const result = await handler(
      { toolName: "exec", params: { command: "audit-cmd" }, toolCallId: "tc-audit" },
      ctx,
    );

    result?.requireApproval?.onResolution?.("allow-always");

    const call = auditLogger.logGuardrailResolution.mock.calls[0][0];
    expect(call.storeAction).toBe("removed");
  });

  it("require_approval onResolution logs guardrail resolution", async () => {
    const auditLogger = mockAuditLogger();
    const grStore = new GuardrailStore(path.join(os.tmpdir(), `gr-test-${Date.now()}.json`));
    grStore.load();
    grStore.add({
      id: "gr_test_res",
      tool: "exec",
      identityKey: "dangerous-cmd",
      matchMode: "exact",
      action: { type: "require_approval" },
      agentId: "test-agent",
      createdAt: new Date().toISOString(),
      source: { toolCallId: "tc-orig", sessionKey: "s1", agentId: "test-agent" },
      description: "exec — dangerous-cmd",
      riskScore: 75,
    });

    const handler = createBeforeToolCallHandler({
      auditLogger: auditLogger as never,
      config: { ...DEFAULT_CONFIG, guardrailsPath: "" },
      sessionContext: new SessionContext(),
      guardrailStore: grStore,
    });

    const result = await handler(
      { toolName: "exec", params: { command: "dangerous-cmd" }, toolCallId: "tc-007" },
      ctx,
    );

    // Simulate resolution callback
    result?.requireApproval?.onResolution?.("allow-once");

    expect(auditLogger.logGuardrailResolution).toHaveBeenCalledWith(
      expect.objectContaining({
        guardrailId: "gr_test_res",
        toolCallId: "tc-007",
        approved: true,
        decision: "allow-once",
      }),
    );
  });

  it("logs warning when guardrail check throws", async () => {
    const auditLogger = mockAuditLogger();
    const loggerMock = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const grStore = {
      match: vi.fn().mockImplementation(() => {
        throw new Error("corrupted store");
      }),
    };

    const handler = createBeforeToolCallHandler({
      auditLogger: auditLogger as never,
      config: { ...DEFAULT_CONFIG, guardrailsPath: "" },
      sessionContext: new SessionContext(),
      guardrailStore: grStore as never,
      logger: loggerMock,
    });

    const result = await handler(
      { toolName: "exec", params: { command: "echo hi" }, toolCallId: "tc-err" },
      ctx,
    );

    expect(result).toBeUndefined();
    expect(loggerMock.warn).toHaveBeenCalledWith(expect.stringContaining("corrupted store"));
  });
});

// ── Guardrail Action Validation ─────────────────────────────

describe("guardrail action validation", () => {
  it("accepts block", () => {
    expect(isValidGuardrailAction({ type: "block" })).toBe(true);
  });
  it("accepts require_approval", () => {
    expect(isValidGuardrailAction({ type: "require_approval" })).toBe(true);
  });
  it("rejects allow_once (removed action type)", () => {
    expect(isValidGuardrailAction({ type: "allow_once" })).toBe(false);
  });
  it("rejects allow_hours (removed action type)", () => {
    expect(isValidGuardrailAction({ type: "allow_hours", hours: 24 })).toBe(false);
  });
  it("rejects unknown type", () => {
    expect(isValidGuardrailAction({ type: "allow_forever" })).toBe(false);
  });
  it("rejects missing type", () => {
    expect(isValidGuardrailAction({} as unknown)).toBe(false);
  });
  it("rejects null", () => {
    expect(isValidGuardrailAction(null)).toBe(false);
  });
});
