import { describe, it, expect } from "vitest";
import { matchTool, matchParams, matchRule } from "../src/policy/matcher";

describe("matchTool", () => {
  it("matches exact tool name", () => {
    expect(matchTool("exec", "exec")).toBe(true);
    expect(matchTool("read", "exec")).toBe(false);
  });

  it("matches wildcard glob", () => {
    expect(matchTool("web_search", "web_*")).toBe(true);
    expect(matchTool("web_fetch", "web_*")).toBe(true);
    expect(matchTool("exec", "web_*")).toBe(false);
  });

  it("matches array of patterns", () => {
    expect(matchTool("write", ["write", "edit"])).toBe(true);
    expect(matchTool("edit", ["write", "edit"])).toBe(true);
    expect(matchTool("read", ["write", "edit"])).toBe(false);
  });

  it("matches * as catch-all", () => {
    expect(matchTool("anything", "*")).toBe(true);
  });
});

describe("matchParams", () => {
  it("matches exact param value", () => {
    expect(matchParams({ command: "ls" }, { command: "ls" })).toBe(true);
    expect(matchParams({ command: "rm" }, { command: "ls" })).toBe(false);
  });

  it("matches glob pattern on params", () => {
    expect(
      matchParams(
        { command: "rm -rf /tmp/stuff" },
        { command: "*rm -rf*" },
      ),
    ).toBe(true);
    expect(
      matchParams({ command: "ls -la" }, { command: "*rm -rf*" }),
    ).toBe(false);
  });

  it("returns false when param key is missing", () => {
    expect(matchParams({}, { command: "*rm*" })).toBe(false);
    expect(matchParams({ path: "/tmp" }, { command: "*rm*" })).toBe(false);
  });

  it("matches multiple param patterns (all must match)", () => {
    expect(
      matchParams(
        { to: "boss@company.com", subject: "Report" },
        { to: "*@company.com" },
      ),
    ).toBe(true);
  });

  it("converts non-string params to string for matching", () => {
    expect(matchParams({ count: 42 }, { count: "42" })).toBe(true);
  });
});

describe("matchRule", () => {
  it("empty match matches everything (catch-all)", () => {
    expect(matchRule("exec", { command: "ls" }, {})).toBe(true);
    expect(matchRule("read", {}, {})).toBe(true);
  });

  it("matches tool only", () => {
    expect(matchRule("exec", {}, { tool: "exec" })).toBe(true);
    expect(matchRule("read", {}, { tool: "exec" })).toBe(false);
  });

  it("matches tool + params", () => {
    expect(
      matchRule(
        "exec",
        { command: "rm -rf /" },
        { tool: "exec", params: { command: "*rm -rf*" } },
      ),
    ).toBe(true);

    expect(
      matchRule(
        "exec",
        { command: "ls -la" },
        { tool: "exec", params: { command: "*rm -rf*" } },
      ),
    ).toBe(false);
  });

  it("fails if tool matches but params don't", () => {
    expect(
      matchRule(
        "exec",
        { command: "echo hello" },
        { tool: "exec", params: { command: "*rm*" } },
      ),
    ).toBe(false);
  });

  it("matches params only (no tool constraint)", () => {
    expect(
      matchRule(
        "anything",
        { path: "/tmp/secret.key" },
        { params: { path: "/tmp/*" } },
      ),
    ).toBe(true);
  });
});
