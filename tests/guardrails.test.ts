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

  it("extracts command for process tool", () => {
    expect(extractIdentityKey("process", { command: "npm install" })).toBe("npm install");
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

  it("extracts query for search tool", () => {
    expect(extractIdentityKey("search", { query: "find bugs" })).toBe("find bugs");
  });

  it("extracts url for browser tool", () => {
    expect(extractIdentityKey("browser", { url: "https://app.com" })).toBe("https://app.com");
  });

  it("extracts to for message tool", () => {
    expect(extractIdentityKey("message", { to: "user@example.com" })).toBe("user@example.com");
  });

  it("extracts recipient for message tool (fallback)", () => {
    expect(extractIdentityKey("message", { recipient: "#general" })).toBe("#general");
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

  it("normalizes browser URL: trailing slash + case", () => {
    expect(extractIdentityKey("browser", { url: "https://App.Com/" })).toBe("https://app.com");
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
    it("normalizes process tool identically", () => {
      expect(extractIdentityKey("process", { command: "/usr/local/bin/node script.js" })).toBe(
        "node script.js",
      );
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
    expect(extractIdentityKey("message", {})).toBe("");
  });

  // ── Query/message/cron/spawn normalization ────────────────

  describe("query/message/cron/spawn normalization", () => {
    it("trims and lowercases web_search query", () => {
      expect(extractIdentityKey("web_search", { query: "  Node Security  " })).toBe(
        "node security",
      );
    });
    it("trims and lowercases search query", () => {
      expect(extractIdentityKey("search", { query: "FIND Bugs" })).toBe("find bugs");
    });
    it("trims and lowercases memory_search query", () => {
      expect(extractIdentityKey("memory_search", { query: "  API Keys  " })).toBe("api keys");
    });
    it("trims and lowercases memory_get key", () => {
      expect(extractIdentityKey("memory_get", { key: " Config.Auth " })).toBe("config.auth");
    });
    it("trims and lowercases message recipient", () => {
      expect(extractIdentityKey("message", { to: "User@Example.COM" })).toBe("user@example.com");
    });
    it("trims and lowercases message recipient (fallback)", () => {
      expect(extractIdentityKey("message", { recipient: " #General " })).toBe("#general");
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

  // ── Glob and grep tool coverage ───────────────────────────

  describe("glob and grep tool coverage", () => {
    it("extracts pattern for glob tool", () => {
      expect(extractIdentityKey("glob", { pattern: "**/*.env" })).toBe("**/*.env");
    });
    it("extracts pattern for grep tool", () => {
      expect(extractIdentityKey("grep", { pattern: "API_KEY" })).toBe("API_KEY");
    });
    it("glob ignores non-pattern params", () => {
      expect(extractIdentityKey("glob", { pattern: "**/*.ts", path: "/app" })).toBe("**/*.ts");
      expect(extractIdentityKey("glob", { pattern: "**/*.ts", limit: 10 })).toBe("**/*.ts");
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
      expiresAt: null,
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

    it("removes expired guardrail on match", () => {
      store.load();
      const g = makeGuardrail({
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      });
      store.add(g);

      const result = store.match("test-agent", "exec", "curl https://example.com");
      expect(result).toBeNull();
      expect(store.list()).toHaveLength(0);
    });

    it("returns non-expired guardrail", () => {
      store.load();
      const g = makeGuardrail({
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      });
      store.add(g);

      const result = store.match("test-agent", "exec", "curl https://example.com");
      expect(result?.id).toBe(g.id);
    });

    it("auto-removes allow_once after match", () => {
      store.load();
      const g = makeGuardrail({ action: { type: "allow_once" } });
      store.add(g);

      const result = store.match("test-agent", "exec", "curl https://example.com");
      expect(result?.action.type).toBe("allow_once");
      // Should be removed after match
      expect(store.list()).toHaveLength(0);
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
      const g = makeGuardrail({ action: { type: "allow_once" } });
      store.add(g);

      const result = store.peek("test-agent", "exec", "curl https://example.com");
      expect(result?.id).toBe(g.id);
      // Not removed
      expect(store.list()).toHaveLength(1);
    });

    it("skips expired and triggers lazy cleanup", () => {
      store.load();
      store.add(makeGuardrail({ expiresAt: new Date(Date.now() - 1000).toISOString() }));

      const result = store.peek("test-agent", "exec", "curl https://example.com");
      expect(result).toBeNull();
      // Cleaned by peek via cleanExpired()
      expect(store.list()).toHaveLength(0);
    });

    it("lazily cleans expired on peek when expired encountered", () => {
      store.load();
      for (let i = 0; i < 5; i++) {
        store.add(
          makeGuardrail({
            identityKey: `expired-${i}`,
            expiresAt: new Date(Date.now() - 1000).toISOString(),
          }),
        );
      }
      store.add(makeGuardrail({ identityKey: "valid", expiresAt: null }));

      // Peek hits an expired entry, triggering cleanup
      store.peek("test-agent", "exec", "expired-0");
      expect(store.list().length).toBe(1);
      expect(store.list()[0].identityKey).toBe("valid");
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

  it("cleanExpired() removes stale guardrails", () => {
    store.load();
    store.add(makeGuardrail({ expiresAt: new Date(Date.now() - 1000).toISOString() }));
    store.add(makeGuardrail({ expiresAt: null }));

    store.cleanExpired();
    expect(store.list()).toHaveLength(1);
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
      expiresAt: null,
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
    // Risk scoring should NOT have been called (blocked before scoring)
    expect(mockComputeRiskScore).not.toHaveBeenCalled();
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
      expiresAt: null,
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

  it("allows through and continues to scoring for allow_once", async () => {
    const auditLogger = mockAuditLogger();
    const grStore = new GuardrailStore(path.join(os.tmpdir(), `gr-test-${Date.now()}.json`));
    grStore.load();
    grStore.add({
      id: "gr_test3",
      tool: "exec",
      identityKey: "ls -la",
      matchMode: "exact",
      action: { type: "allow_once" },
      agentId: "test-agent",
      createdAt: new Date().toISOString(),
      expiresAt: null,
      source: { toolCallId: "tc-orig", sessionKey: "s1", agentId: "test-agent" },
      description: "exec — ls -la",
      riskScore: 10,
    });

    const handler = createBeforeToolCallHandler({
      auditLogger: auditLogger as never,
      config: { ...DEFAULT_CONFIG, guardrailsPath: "" },
      sessionContext: new SessionContext(),
      guardrailStore: grStore,
    });

    const result = await handler(
      { toolName: "exec", params: { command: "ls -la" }, toolCallId: "tc-004" },
      ctx,
    );

    // Should fall through (undefined = allow)
    expect(result).toBeUndefined();
    // Risk scoring SHOULD have run
    expect(mockComputeRiskScore).toHaveBeenCalledOnce();
    // Guardrail match should be logged
    expect(auditLogger.logGuardrailMatch).toHaveBeenCalledOnce();
    // allow_once guardrail should have been consumed
    expect(grStore.list()).toHaveLength(0);
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
      expiresAt: null,
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
  it("accepts allow_once", () => {
    expect(isValidGuardrailAction({ type: "allow_once" })).toBe(true);
  });
  it("accepts allow_hours with valid hours", () => {
    expect(isValidGuardrailAction({ type: "allow_hours", hours: 24 })).toBe(true);
  });
  it("rejects unknown type", () => {
    expect(isValidGuardrailAction({ type: "allow_forever" })).toBe(false);
  });
  it("rejects missing type", () => {
    expect(isValidGuardrailAction({} as unknown)).toBe(false);
  });
  it("rejects allow_hours without hours", () => {
    expect(isValidGuardrailAction({ type: "allow_hours" })).toBe(false);
  });
  it("rejects allow_hours with negative hours", () => {
    expect(isValidGuardrailAction({ type: "allow_hours", hours: -1 })).toBe(false);
  });
  it("rejects null", () => {
    expect(isValidGuardrailAction(null)).toBe(false);
  });
});
