import { describe, it, expect, beforeEach } from "vitest";
import { PolicyEngine } from "../src/policy/engine";
import type { Policy } from "../src/policy/types";

const standardPolicy: Policy = {
  version: "1",
  defaults: {
    unknown_actions: "approval_required",
    approval_timeout: 300,
    timeout_action: "deny",
    digest: "daily",
  },
  rules: [
    {
      name: "Block rm -rf",
      match: { tool: "exec", params: { command: "*rm -rf*" } },
      action: "block",
      reason: "Destructive command blocked",
    },
    {
      name: "Block force push",
      match: { tool: "exec", params: { command: "*git push*--force*" } },
      action: "block",
      reason: "Force push blocked",
    },
    {
      name: "Approve shell commands",
      match: { tool: "exec" },
      action: "approval_required",
    },
    {
      name: "Approve file writes",
      match: { tool: ["write", "edit"] },
      action: "approval_required",
    },
    {
      name: "Allow reads",
      match: { tool: "read" },
      action: "allow",
    },
    {
      name: "Allow search",
      match: { tool: ["web_search", "memory_search", "glob", "grep"] },
      action: "allow",
    },
    {
      name: "Allow web fetch (rate limited)",
      match: { tool: "web_fetch" },
      action: "allow",
      rate_limit: {
        max: 30,
        window: 3600,
        on_exceed: "approval_required",
      },
    },
    {
      name: "Default",
      match: {},
      action: "approval_required",
    },
  ],
};

describe("PolicyEngine", () => {
  let engine: PolicyEngine;

  beforeEach(() => {
    engine = new PolicyEngine();
    engine.load(standardPolicy);
  });

  describe("first-match-wins", () => {
    it("blocks rm -rf (specific rule before general exec)", () => {
      const result = engine.evaluate("exec", {
        command: "rm -rf /tmp/stuff",
      });
      expect(result.action).toBe("block");
      expect(result.ruleName).toBe("Block rm -rf");
      expect(result.reason).toBe("Destructive command blocked");
    });

    it("blocks force push", () => {
      const result = engine.evaluate("exec", {
        command: "git push origin main --force",
      });
      expect(result.action).toBe("block");
      expect(result.ruleName).toBe("Block force push");
    });

    it("requires approval for other exec commands", () => {
      const result = engine.evaluate("exec", { command: "ls -la" });
      expect(result.action).toBe("approval_required");
      expect(result.ruleName).toBe("Approve shell commands");
    });
  });

  describe("tool matching", () => {
    it("allows reads", () => {
      const result = engine.evaluate("read", { path: "/etc/hosts" });
      expect(result.action).toBe("allow");
      expect(result.ruleName).toBe("Allow reads");
    });

    it("allows search tools (array match)", () => {
      expect(engine.evaluate("web_search", { query: "test" }).action).toBe(
        "allow",
      );
      expect(engine.evaluate("glob", { pattern: "*.ts" }).action).toBe(
        "allow",
      );
      expect(engine.evaluate("grep", { pattern: "foo" }).action).toBe(
        "allow",
      );
    });

    it("requires approval for write/edit (array match)", () => {
      expect(engine.evaluate("write", { path: "/tmp/file" }).action).toBe(
        "approval_required",
      );
      expect(engine.evaluate("edit", { path: "/tmp/file" }).action).toBe(
        "approval_required",
      );
    });
  });

  describe("unknown actions fallback", () => {
    it("uses defaults.unknown_actions when no rule matches", () => {
      // Load a policy with no catch-all rule
      const noDefaultPolicy: Policy = {
        version: "1",
        defaults: {
          unknown_actions: "block",
          approval_timeout: 300,
          timeout_action: "deny",
          digest: "daily",
        },
        rules: [
          {
            name: "Allow reads",
            match: { tool: "read" },
            action: "allow",
          },
        ],
      };

      engine.load(noDefaultPolicy);

      const result = engine.evaluate("exec", { command: "ls" });
      expect(result.action).toBe("block");
    });

    it("catch-all rule matches unknown tools", () => {
      const result = engine.evaluate("unknown_tool", {});
      expect(result.action).toBe("approval_required");
      expect(result.ruleName).toBe("Default");
    });
  });

  describe("rate limits", () => {
    it("returns rule action when under limit", () => {
      const getCount = () => 5;
      const result = engine.evaluate("web_fetch", { url: "https://example.com" }, getCount);
      expect(result.action).toBe("allow");
    });

    it("returns on_exceed action when over limit", () => {
      const getCount = () => 30;
      const result = engine.evaluate("web_fetch", { url: "https://example.com" }, getCount);
      expect(result.action).toBe("approval_required");
      expect(result.ruleName).toBe("Allow web fetch (rate limited)");
    });

    it("returns on_exceed action when at exact limit", () => {
      const getCount = () => 30;
      const result = engine.evaluate("web_fetch", {}, getCount);
      expect(result.action).toBe("approval_required");
    });
  });

  describe("no policy loaded", () => {
    it("fails closed (blocks) when no policy is loaded", () => {
      const empty = new PolicyEngine();
      const result = empty.evaluate("read", {});
      expect(result.action).toBe("block");
    });
  });

  describe("getBlockedTools / getApprovalRequiredTools", () => {
    it("lists blocked tools", () => {
      const blocked = engine.getBlockedTools();
      expect(blocked.length).toBeGreaterThan(0);
      expect(blocked.some((t) => t.includes("exec"))).toBe(true);
    });

    it("lists approval-required tools", () => {
      const approval = engine.getApprovalRequiredTools();
      expect(approval.length).toBeGreaterThan(0);
      expect(approval).toContain("exec");
    });

    it("returns empty arrays when no policy loaded", () => {
      const empty = new PolicyEngine();
      expect(empty.getBlockedTools()).toEqual([]);
      expect(empty.getApprovalRequiredTools()).toEqual([]);
    });
  });
});
