import { describe, expect, it } from "vitest";
import { buildInitConfigSnippet } from "../index";

describe("buildInitConfigSnippet", () => {
  it("uses the provided plugin directory, not a hardcoded path", () => {
    const snippet = buildInitConfigSnippet({
      pluginDir: "/tmp/some/where/clawlens",
      auditLogPath: "/tmp/test-audit.jsonl",
    });
    const parsed = JSON.parse(snippet);
    expect(parsed.plugins.load.paths).toEqual(["/tmp/some/where/clawlens"]);
    expect(snippet).not.toMatch(/~\/code\/clawLens/);
    expect(snippet).not.toMatch(/neelabh/i);
  });

  it("includes the auditLogPath under the clawlens config block", () => {
    const snippet = buildInitConfigSnippet({
      pluginDir: "/p",
      auditLogPath: "/a/audit.jsonl",
    });
    const parsed = JSON.parse(snippet);
    expect(parsed.plugins.entries.clawlens.config.auditLogPath).toBe("/a/audit.jsonl");
    expect(parsed.plugins.entries.clawlens.enabled).toBe(true);
  });

  it("produces 2-space indented JSON that round-trips", () => {
    const snippet = buildInitConfigSnippet({ pluginDir: "/x", auditLogPath: "/y" });
    expect(snippet).toContain("\n  ");
    expect(() => JSON.parse(snippet)).not.toThrow();
  });
});
