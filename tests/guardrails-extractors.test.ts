import { describe, expect, it } from "vitest";
import { extractAllPatchPaths } from "../src/dashboard/categories";
import {
  extractCommandForGuardrail,
  extractPathsForGuardrail,
  extractUrlsForGuardrail,
} from "../src/guardrails/identity";

describe("extractUrlsForGuardrail", () => {
  it("returns the normalized URL for web_fetch", () => {
    expect(extractUrlsForGuardrail("web_fetch", { url: "https://apnews.com/hub" })).toEqual([
      "https://apnews.com/hub",
    ]);
  });
  it("returns the normalized URL for fetch_url", () => {
    expect(extractUrlsForGuardrail("fetch_url", { url: "https://example.com" })).toEqual([
      "https://example.com",
    ]);
  });
  it("returns the URL for browser regardless of action", () => {
    expect(extractUrlsForGuardrail("browser", { action: "click", url: "https://app.com" })).toEqual(
      ["https://app.com"],
    );
  });
  it("returns [] for browser with missing url", () => {
    expect(extractUrlsForGuardrail("browser", { action: "click" })).toEqual([]);
  });
  it("returns [] for web_fetch with missing url", () => {
    expect(extractUrlsForGuardrail("web_fetch", {})).toEqual([]);
  });
  it("normalizes web_fetch URL (case, default port, fragment)", () => {
    expect(
      extractUrlsForGuardrail("web_fetch", { url: "HTTPS://APNEWS.COM:443/path#frag" }),
    ).toEqual(["https://apnews.com/path"]);
  });

  it("returns the URL embedded in an exec curl command", () => {
    expect(extractUrlsForGuardrail("exec", { command: "curl https://apnews.com" })).toEqual([
      "https://apnews.com",
    ]);
  });
  it("returns multiple URLs for chained exec commands", () => {
    const urls = extractUrlsForGuardrail("exec", {
      command: "curl https://a.com && wget https://b.com",
    });
    expect(urls.sort()).toEqual(["https://a.com", "https://b.com"]);
  });
  it("returns [] for exec with no URLs", () => {
    expect(extractUrlsForGuardrail("exec", { command: "ls -la" })).toEqual([]);
  });
  it("returns [] for exec with no command param", () => {
    expect(extractUrlsForGuardrail("exec", {})).toEqual([]);
  });

  it("returns [] for non-URL tools", () => {
    expect(extractUrlsForGuardrail("read", { path: "/etc/passwd" })).toEqual([]);
    expect(extractUrlsForGuardrail("write", { path: "/etc/passwd" })).toEqual([]);
    expect(extractUrlsForGuardrail("apply_patch", { patch: "x" })).toEqual([]);
    expect(extractUrlsForGuardrail("message", { action: "send", target: "#chan" })).toEqual([]);
  });
});

describe("extractPathsForGuardrail", () => {
  it("returns the normalized path for read", () => {
    expect(extractPathsForGuardrail("read", { path: "/etc/passwd" })).toEqual(["/etc/passwd"]);
  });
  it("returns the normalized path for write (collapses double-slash, strips leading ./)", () => {
    expect(extractPathsForGuardrail("write", { path: "./src//main.ts" })).toEqual(["src/main.ts"]);
  });
  it("returns the normalized path for edit", () => {
    expect(extractPathsForGuardrail("edit", { path: "/a" })).toEqual(["/a"]);
  });
  it("falls back to file_path for read/write/edit", () => {
    expect(extractPathsForGuardrail("read", { file_path: "/etc/hosts" })).toEqual(["/etc/hosts"]);
  });
  it("returns the path (NOT pattern) for find — operators use identity-glob to match the pattern itself", () => {
    expect(extractPathsForGuardrail("find", { path: "/app", pattern: "**/*.env" })).toEqual([
      "/app",
    ]);
  });
  it("returns the path for grep", () => {
    expect(extractPathsForGuardrail("grep", { path: "/src", pattern: "TODO" })).toEqual(["/src"]);
  });
  it("returns the path for ls", () => {
    expect(extractPathsForGuardrail("ls", { path: "/Users/me" })).toEqual(["/Users/me"]);
  });
  it("returns [] when path missing for read/write/edit/find/grep/ls", () => {
    expect(extractPathsForGuardrail("read", {})).toEqual([]);
    expect(extractPathsForGuardrail("write", {})).toEqual([]);
    expect(extractPathsForGuardrail("edit", {})).toEqual([]);
    expect(extractPathsForGuardrail("find", { pattern: "x" })).toEqual([]);
    expect(extractPathsForGuardrail("grep", { pattern: "x" })).toEqual([]);
    expect(extractPathsForGuardrail("ls", {})).toEqual([]);
  });

  it("returns all patch paths for apply_patch (unified diff)", () => {
    const patch = `--- a/etc/secrets/foo
+++ b/etc/secrets/foo
@@ -1 +1 @@
-old
+new`;
    expect(extractPathsForGuardrail("apply_patch", { patch })).toEqual(["etc/secrets/foo"]);
  });
  it("returns all patch paths for apply_patch (Codex format)", () => {
    const patch = `*** Update File: /etc/secrets/foo
@@
-old
+new`;
    expect(extractPathsForGuardrail("apply_patch", { patch })).toEqual(["/etc/secrets/foo"]);
  });
  it("returns multiple paths for multi-file apply_patch", () => {
    const patch = `--- a/etc/secrets/foo
+++ b/etc/secrets/foo
@@ -1 +1 @@
-x
+y
--- a/tmp/scratch
+++ b/tmp/scratch
@@ -1 +1 @@
-x
+y`;
    expect(extractPathsForGuardrail("apply_patch", { patch }).sort()).toEqual([
      "etc/secrets/foo",
      "tmp/scratch",
    ]);
  });
  it("returns [] for malformed apply_patch — never auto-match-on-empty (§5.2)", () => {
    expect(extractPathsForGuardrail("apply_patch", { patch: "garbage" })).toEqual([]);
    expect(extractPathsForGuardrail("apply_patch", { patch: "" })).toEqual([]);
    expect(extractPathsForGuardrail("apply_patch", {})).toEqual([]);
  });

  it("returns [] for non-path tools", () => {
    expect(extractPathsForGuardrail("exec", { command: "ls" })).toEqual([]);
    expect(extractPathsForGuardrail("web_fetch", { url: "https://x" })).toEqual([]);
    expect(extractPathsForGuardrail("message", {})).toEqual([]);
  });
});

describe("extractCommandForGuardrail", () => {
  it("returns the normalized command for exec", () => {
    expect(extractCommandForGuardrail("exec", { command: "/usr/bin/curl -s https://x" })).toBe(
      "curl -s https://x",
    );
  });
  it("returns null for non-exec tools", () => {
    expect(extractCommandForGuardrail("read", { path: "/x" })).toBeNull();
    expect(extractCommandForGuardrail("write", {})).toBeNull();
    expect(extractCommandForGuardrail("web_fetch", { url: "https://x" })).toBeNull();
    expect(extractCommandForGuardrail("apply_patch", { patch: "x" })).toBeNull();
  });
  it("returns empty string for exec with no command param (no auto-match-on-empty for command-glob is the matcher's job)", () => {
    expect(extractCommandForGuardrail("exec", {})).toBe("");
  });
});

// ── Tests for the categories.ts helper directly ─────────────
// extractAllPatchPaths replaces extractFirstPatchPath; the legacy helper now
// delegates via extractAllPatchPaths(patch)[0] ?? "" so the two stay in sync.

describe("extractAllPatchPaths (categories.ts)", () => {
  it("returns one path for a single-file unified diff (deduped --- and +++)", () => {
    const patch = `--- a/foo
+++ b/foo
@@ -1 +1 @@
-x
+y`;
    expect(extractAllPatchPaths(patch)).toEqual(["foo"]);
  });
  it("returns one path per file for a multi-file unified diff", () => {
    const patch = `--- a/foo
+++ b/foo
@@ -1 +1 @@
-x
+y
--- a/bar
+++ b/bar
@@ -1 +1 @@
-x
+y`;
    expect(extractAllPatchPaths(patch).sort()).toEqual(["bar", "foo"]);
  });
  it("returns paths from Codex-style headers", () => {
    const patch = `*** Update File: /etc/secrets/foo
@@
*** Add File: /tmp/new
@@
*** Delete File: /old`;
    expect(extractAllPatchPaths(patch).sort()).toEqual(["/etc/secrets/foo", "/old", "/tmp/new"]);
  });
  it("normalizes paths via normalizePath (collapses //, strips trailing slash)", () => {
    const patch = `--- a/etc//secrets/
+++ b/etc//secrets/`;
    expect(extractAllPatchPaths(patch)).toEqual(["etc/secrets"]);
  });
  it("returns [] for empty patch", () => {
    expect(extractAllPatchPaths("")).toEqual([]);
  });
  it("returns [] for malformed patch (no recognizable header)", () => {
    expect(extractAllPatchPaths("not a patch")).toEqual([]);
  });
  it("returns [] for whitespace-only patch", () => {
    expect(extractAllPatchPaths("\n\n   \n")).toEqual([]);
  });
  it("handles a patch mixing unified-diff and Codex headers", () => {
    const patch = `*** Update File: /a
@@
--- a/b
+++ b/b`;
    expect(extractAllPatchPaths(patch).sort()).toEqual(["/a", "b"]);
  });
});
