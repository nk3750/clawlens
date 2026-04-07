import { describe, expect, it } from "vitest";
import {
  computeBreakdown,
  describeAction,
  getCategory,
  parseSessionContext,
  riskPosture,
} from "../src/dashboard/categories";

describe("getCategory", () => {
  it("maps read tools to exploring", () => {
    expect(getCategory("read")).toBe("exploring");
    expect(getCategory("glob")).toBe("exploring");
    expect(getCategory("grep")).toBe("exploring");
    expect(getCategory("search")).toBe("exploring");
    expect(getCategory("memory_search")).toBe("exploring");
  });

  it("maps write/edit to changes", () => {
    expect(getCategory("write")).toBe("changes");
    expect(getCategory("edit")).toBe("changes");
  });

  it("maps exec to commands", () => {
    expect(getCategory("exec")).toBe("commands");
    expect(getCategory("process")).toBe("commands");
  });

  it("maps web tools to web", () => {
    expect(getCategory("fetch_url")).toBe("web");
    expect(getCategory("web_fetch")).toBe("web");
    expect(getCategory("web_search")).toBe("web");
    expect(getCategory("browser")).toBe("web");
  });

  it("maps message/spawn to comms", () => {
    expect(getCategory("message")).toBe("comms");
    expect(getCategory("sessions_spawn")).toBe("comms");
  });

  it("maps cron to data", () => {
    expect(getCategory("cron")).toBe("data");
  });

  it("defaults unknown tools to commands", () => {
    expect(getCategory("unknown_tool")).toBe("commands");
    expect(getCategory("custom_action")).toBe("commands");
  });
});

describe("computeBreakdown", () => {
  it("returns all zeros for empty entries", () => {
    const result = computeBreakdown([]);
    expect(result).toEqual({
      exploring: 0,
      changes: 0,
      commands: 0,
      web: 0,
      comms: 0,
      data: 0,
    });
  });

  it("computes correct percentages", () => {
    const entries = [
      { toolName: "read" },
      { toolName: "read" },
      { toolName: "read" },
      { toolName: "exec" },
    ];
    const result = computeBreakdown(entries);
    expect(result.exploring).toBe(75);
    expect(result.commands).toBe(25);
    expect(result.changes).toBe(0);
  });

  it("percentages sum to 100", () => {
    const entries = [{ toolName: "read" }, { toolName: "write" }, { toolName: "exec" }];
    const result = computeBreakdown(entries);
    const sum = Object.values(result).reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
  });

  it("handles single entry", () => {
    const result = computeBreakdown([{ toolName: "exec" }]);
    expect(result.commands).toBe(100);
    const sum = Object.values(result).reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
  });

  it("handles rounding edge cases", () => {
    // 3 entries across 3 categories = 33.33% each
    const entries = [{ toolName: "read" }, { toolName: "write" }, { toolName: "exec" }];
    const result = computeBreakdown(entries);
    const sum = Object.values(result).reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
  });
});

describe("parseSessionContext", () => {
  it("parses cron session keys", () => {
    expect(parseSessionContext("agent:social-manager:cron:trend-scan-tweet-006")).toBe(
      "Cron: Trend scan tweet",
    );
  });

  it("parses cron with health-check", () => {
    expect(parseSessionContext("agent:debugger:cron:f62h5ig4-health-check")).toBe(
      "Cron: F62h5ig4 health check",
    );
  });

  it("parses telegram direct sessions", () => {
    expect(parseSessionContext("agent:main:telegram:direct:7928586762")).toBe("Telegram DM");
  });

  it("parses main sessions", () => {
    expect(parseSessionContext("agent:debugger:main")).toBe("Direct session");
  });

  it("returns undefined for empty string", () => {
    expect(parseSessionContext("")).toBeUndefined();
  });

  it("returns undefined for too-short keys", () => {
    expect(parseSessionContext("agent:main")).toBeUndefined();
  });

  it("returns undefined for unknown channel", () => {
    expect(parseSessionContext("agent:main:unknown")).toBeUndefined();
  });
});

describe("describeAction", () => {
  it("describes read actions", () => {
    expect(describeAction({ toolName: "read", params: { path: "/src/auth/config.yaml" } })).toBe(
      "Read .../auth/config.yaml",
    );
  });

  it("describes read with short path", () => {
    expect(describeAction({ toolName: "read", params: { path: "config.yaml" } })).toBe(
      "Read config.yaml",
    );
  });

  it("describes write actions", () => {
    expect(describeAction({ toolName: "write", params: { path: "/tmp/out.txt" } })).toBe(
      "Write .../tmp/out.txt",
    );
  });

  it("describes exec with command", () => {
    const result = describeAction({
      toolName: "exec",
      params: { command: "npm test" },
    });
    expect(result).toBe("Ran npm test");
  });

  it("describes exec with complex command", () => {
    const result = describeAction({
      toolName: "exec",
      params: { command: "cat /etc/hosts" },
    });
    expect(result).toBe("Ran cat /etc/hosts");
  });

  it("truncates long commands", () => {
    const result = describeAction({
      toolName: "exec",
      params: { command: "python3 -c \"print('a' * 100 + 'b' * 100 + 'c' * 100)\"" },
    });
    expect(result.length).toBeLessThan(60);
  });

  it("describes grep actions", () => {
    expect(describeAction({ toolName: "grep", params: { pattern: "TODO" } })).toBe('Grep "TODO"');
  });

  it("describes message actions", () => {
    expect(describeAction({ toolName: "message", params: { to: "team-channel" } })).toBe(
      "Message team-channel",
    );
  });

  it("describes web search", () => {
    expect(describeAction({ toolName: "web_search", params: { query: "Node.js 22" } })).toBe(
      'Search "Node.js 22"',
    );
  });

  it("handles missing params gracefully", () => {
    expect(describeAction({ toolName: "read", params: {} })).toBe("Read file");
    expect(describeAction({ toolName: "exec", params: {} })).toBe("Run command");
    expect(describeAction({ toolName: "message", params: {} })).toBe("Send message");
  });

  it("returns tool name for unknown tools", () => {
    expect(describeAction({ toolName: "custom_tool", params: {} })).toBe("custom_tool");
  });
});

describe("riskPosture", () => {
  it("returns calm for low scores", () => {
    expect(riskPosture(0)).toBe("calm");
    expect(riskPosture(10)).toBe("calm");
    expect(riskPosture(20)).toBe("calm");
  });

  it("returns elevated for medium scores", () => {
    expect(riskPosture(21)).toBe("elevated");
    expect(riskPosture(35)).toBe("elevated");
    expect(riskPosture(45)).toBe("elevated");
  });

  it("returns high for high scores", () => {
    expect(riskPosture(46)).toBe("high");
    expect(riskPosture(60)).toBe("high");
    expect(riskPosture(70)).toBe("high");
  });

  it("returns critical for very high scores", () => {
    expect(riskPosture(71)).toBe("critical");
    expect(riskPosture(85)).toBe("critical");
    expect(riskPosture(100)).toBe("critical");
  });
});
