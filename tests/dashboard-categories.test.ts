import { describe, expect, it } from "vitest";
import type { ActivityCategory } from "../src/dashboard/categories";
import {
  ALL_CATEGORIES,
  computeBreakdown,
  describeAction,
  getCategory,
  parseSessionContext,
  riskPosture,
} from "../src/dashboard/categories";

describe("getCategory — non-exec tools", () => {
  it("maps read-family tools to exploring", () => {
    expect(getCategory("read")).toBe("exploring");
    expect(getCategory("glob")).toBe("exploring");
    expect(getCategory("grep")).toBe("exploring");
    expect(getCategory("search")).toBe("exploring");
    expect(getCategory("memory_search")).toBe("exploring");
    expect(getCategory("memory_get")).toBe("exploring");
  });

  it("maps mutating tools (write/edit/process/cron) to changes", () => {
    // cron is the scheduling TOOL (rare). Routed to changes because installing
    // a schedule mutates system state. cron *channel* is handled separately in
    // parseSessionContext and never appears as a tool name here.
    expect(getCategory("write")).toBe("changes");
    expect(getCategory("edit")).toBe("changes");
    expect(getCategory("process")).toBe("changes");
    expect(getCategory("cron")).toBe("changes");
  });

  it("maps web tools to web", () => {
    expect(getCategory("fetch_url")).toBe("web");
    expect(getCategory("web_fetch")).toBe("web");
    expect(getCategory("web_search")).toBe("web");
    expect(getCategory("browser")).toBe("web");
  });

  it("maps message to comms", () => {
    // sessions_spawn moved to orchestration in rev 2 of the activity-category-
    // coverage spec — see the dedicated orchestration block below.
    expect(getCategory("message")).toBe("comms");
  });

  it("falls back to scripts for unknown tool names", () => {
    expect(getCategory("unknown_tool")).toBe("scripts");
    expect(getCategory("custom_action")).toBe("scripts");
  });

  it("falls back to scripts for bare exec without sub-category", () => {
    // No execCategory arg → `exec` has no entry in TOOL_TO_CATEGORY, falls
    // through to the scripts fallback rather than to a dead `commands` bucket.
    expect(getCategory("exec")).toBe("scripts");
  });

  it("ignores execCategory for non-exec tools", () => {
    // Non-exec routing is purely toolName-driven; passing execCategory should
    // have no effect. Guards against accidental over-routing if an upstream
    // stamps an arbitrary sub-category on a non-exec entry.
    expect(getCategory("read", "destructive")).toBe("exploring");
    expect(getCategory("web_fetch", "git-write")).toBe("web");
    expect(getCategory("message", "scripting")).toBe("comms");
  });
});

describe("getCategory — exec sub-categories (all 15 ExecCategory values)", () => {
  it("routes read-only / search / system-info to exploring", () => {
    expect(getCategory("exec", "read-only")).toBe("exploring");
    expect(getCategory("exec", "search")).toBe("exploring");
    expect(getCategory("exec", "system-info")).toBe("exploring");
  });

  it("routes destructive / permissions / persistence to changes", () => {
    // These were the observability gap that motivated the split: chmod, crontab,
    // rm -rf all sit in the filesystem/system-state mutation lane alongside
    // write/edit. Risk severity is now shown by the per-card microbar.
    expect(getCategory("exec", "destructive")).toBe("changes");
    expect(getCategory("exec", "permissions")).toBe("changes");
    expect(getCategory("exec", "persistence")).toBe("changes");
  });

  it("routes git-read / git-write to git", () => {
    expect(getCategory("exec", "git-read")).toBe("git");
    expect(getCategory("exec", "git-write")).toBe("git");
  });

  it("routes scripting / package-mgmt / echo / unknown-exec to scripts", () => {
    expect(getCategory("exec", "scripting")).toBe("scripts");
    expect(getCategory("exec", "package-mgmt")).toBe("scripts");
    expect(getCategory("exec", "echo")).toBe("scripts");
    expect(getCategory("exec", "unknown-exec")).toBe("scripts");
  });

  it("routes network-read / network-write / remote to web", () => {
    // remote (ssh/scp/rsync) is network activity — reviewer's mental bucket
    // for `web` on the card includes "talking to other machines."
    expect(getCategory("exec", "network-read")).toBe("web");
    expect(getCategory("exec", "network-write")).toBe("web");
    expect(getCategory("exec", "remote")).toBe("web");
  });

  it("falls back to scripts for unknown exec sub-category", () => {
    expect(getCategory("exec", "not-a-real-category")).toBe("scripts");
    expect(getCategory("exec", "")).toBe("scripts");
  });
});

describe("computeBreakdown", () => {
  it("returns all zeros for empty entries", () => {
    const result = computeBreakdown([]);
    expect(result).toEqual({
      exploring: 0,
      changes: 0,
      git: 0,
      scripts: 0,
      web: 0,
      comms: 0,
      orchestration: 0,
      media: 0,
    });
  });

  it("buckets exec entries by explicit execCategory", () => {
    const entries = [
      { toolName: "exec", execCategory: "git-write" },
      { toolName: "exec", execCategory: "git-read" },
      { toolName: "exec", execCategory: "destructive" },
      { toolName: "exec", execCategory: "network-read" },
    ];
    const result = computeBreakdown(entries);
    expect(result.git).toBe(50);
    expect(result.changes).toBe(25);
    expect(result.web).toBe(25);
    expect(result.scripts).toBe(0);
  });

  it("derives execCategory from params.command when not supplied", () => {
    // AuditEntry shape (no execCategory field) must still route correctly.
    const entries = [
      { toolName: "exec", params: { command: "git status" } },
      { toolName: "exec", params: { command: "rm -rf tmp" } },
    ];
    const result = computeBreakdown(entries);
    expect(result.git).toBe(50);
    expect(result.changes).toBe(50);
  });

  it("routes non-exec tools by toolName", () => {
    const entries = [
      { toolName: "read" },
      { toolName: "write" },
      { toolName: "cron" },
      { toolName: "web_fetch" },
    ];
    const result = computeBreakdown(entries);
    expect(result.exploring).toBe(25);
    expect(result.changes).toBe(50); // write + cron (both mutation)
    expect(result.web).toBe(25);
  });

  it("percentages sum to 100 across mixed entries", () => {
    const entries = [
      { toolName: "read" },
      { toolName: "write" },
      { toolName: "exec", execCategory: "git-read" },
    ];
    const result = computeBreakdown(entries);
    const sum = Object.values(result).reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
  });

  it("handles single entry (exec routed via sub-category)", () => {
    const result = computeBreakdown([{ toolName: "exec", execCategory: "scripting" }]);
    expect(result.scripts).toBe(100);
    const sum = Object.values(result).reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
  });

  it("unknown tool falls into scripts bucket", () => {
    const result = computeBreakdown([{ toolName: "never_seen_before" }]);
    expect(result.scripts).toBe(100);
  });

  it("handles rounding edge cases (33/33/33 → sums to 100)", () => {
    const entries = [
      { toolName: "read" },
      { toolName: "write" },
      { toolName: "exec", execCategory: "scripting" },
    ];
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

  it("surfaces 'Unknown' for OpenClaw's explicit unknown channel", () => {
    expect(parseSessionContext("agent:main:unknown")).toBe("Unknown");
  });

  it("surfaces messaging DMs for all catalog channels", () => {
    expect(parseSessionContext("agent:main:slack:direct:U123")).toBe("Slack DM");
    expect(parseSessionContext("agent:main:discord:direct:456")).toBe("Discord DM");
  });

  it("surfaces messaging rooms for Matrix / group chats", () => {
    expect(parseSessionContext("agent:x:matrix:channel:!room:example.org")).toBe("Matrix room");
    expect(parseSessionContext("agent:x:slack:group:G123")).toBe("Slack room");
  });

  it("parses heartbeat / subagent / hook session keys", () => {
    expect(parseSessionContext("agent:x:heartbeat")).toBe("Heartbeat");
    expect(parseSessionContext("agent:x:subagent:abc-123")).toBe("Subagent");
    expect(parseSessionContext("agent:x:hook:before_tool_call")).toBe("Hook: before_tool_call");
  });

  it("title-cases an unrecognized new channel id", () => {
    expect(parseSessionContext("agent:x:some-new-thing")).toBe("Some New Thing");
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

  it("describes exec with command (unknown-exec)", () => {
    const result = describeAction({
      toolName: "exec",
      params: { command: "npm test" },
    });
    expect(result).toBe("Ran npm test");
  });

  it("describes exec read-only with category label", () => {
    const result = describeAction({
      toolName: "exec",
      params: { command: "cat /etc/hosts" },
    });
    expect(result).toBe("Read: cat hosts");
  });

  it("describes exec read-only tail", () => {
    expect(
      describeAction({
        toolName: "exec",
        params: { command: "tail -10 ~/logs/growth-activity.jsonl" },
      }),
    ).toBe("Read: tail growth-activity.jsonl");
  });

  it("describes exec network-read with domain", () => {
    expect(
      describeAction({
        toolName: "exec",
        params: {
          command: "curl -s -m 5 https://streambuddy-production.up.railway.app/v1/healthz",
        },
      }),
    ).toBe("Network: curl streambuddy-production.up.railway.app");
  });

  it("describes exec network-read localhost", () => {
    expect(
      describeAction({ toolName: "exec", params: { command: "curl -s localhost:18789/health" } }),
    ).toBe("Network: curl localhost:18789");
  });

  it("describes exec git-write", () => {
    expect(describeAction({ toolName: "exec", params: { command: "git push --force" } })).toBe(
      "Git: push --force",
    );
  });

  it("describes exec git-read", () => {
    expect(describeAction({ toolName: "exec", params: { command: "git status" } })).toBe(
      "Git: status",
    );
  });

  it("describes exec destructive", () => {
    const result = describeAction({ toolName: "exec", params: { command: "rm -rf /tmp/foo" } });
    expect(result).toBe("Destructive: rm -rf /tmp/foo");
  });

  it("describes exec scripting", () => {
    const result = describeAction({
      toolName: "exec",
      params: { command: "python3 -c \"print('hello')\"" },
    });
    expect(result).toMatch(/^Script: python3/);
  });

  it("describes exec system-info", () => {
    expect(describeAction({ toolName: "exec", params: { command: "df -h" } })).toBe(
      "System: df -h",
    );
  });

  it("describes exec package-mgmt", () => {
    expect(describeAction({ toolName: "exec", params: { command: "npm install lodash" } })).toBe(
      "Package: npm install",
    );
  });

  it("describes exec search", () => {
    expect(describeAction({ toolName: "exec", params: { command: "grep -r TODO src/" } })).toBe(
      "Search: grep TODO",
    );
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

  it("describes message actions with target", () => {
    expect(describeAction({ toolName: "message", params: { target: "team-channel" } })).toBe(
      "Message team-channel",
    );
  });

  it("describes message actions with channel fallback", () => {
    expect(describeAction({ toolName: "message", params: { channel: "#ops" } })).toBe(
      "Message #ops",
    );
  });

  it("describes message: target wins over channel when both present", () => {
    expect(describeAction({ toolName: "message", params: { target: "#a", channel: "#b" } })).toBe(
      "Message #a",
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

  it("describes memory_get", () => {
    expect(describeAction({ toolName: "memory_get", params: {} })).toBe("Memory: retrieve");
  });

  it("describes memory_search", () => {
    expect(describeAction({ toolName: "memory_search", params: {} })).toBe("Memory: search");
  });

  it("describes sessions_spawn with agent name", () => {
    expect(describeAction({ toolName: "sessions_spawn", params: { agent: "debugger" } })).toBe(
      "Spawn: debugger",
    );
  });

  it("describes fetch_url with domain", () => {
    expect(
      describeAction({ toolName: "fetch_url", params: { url: "https://api.example.com/data" } }),
    ).toBe("Fetch: api.example.com");
  });

  it("describes process with action", () => {
    expect(describeAction({ toolName: "process", params: { action: "poll" } })).toBe(
      "Process: poll",
    );
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

// Routing coverage for the 20 tools that the rev-2 activity-category-coverage
// spec rescues from the `scripts` fallback, plus the `sessions_spawn` move
// from `comms` to the new `orchestration` bucket.
describe("activity category coverage — 20 new tool routings", () => {
  const cases: Array<[string, ActivityCategory]> = [
    // changes — top-level write tools
    ["apply_patch", "changes"],
    ["gateway", "changes"],
    // web — outbound search
    ["x_search", "web"],
    // scripts — running code
    ["code_execution", "scripts"],
    // orchestration — agent ↔ agent (NEW BUCKET)
    ["sessions_spawn", "orchestration"], // MOVED from comms
    ["sessions_send", "orchestration"],
    ["sessions_yield", "orchestration"],
    ["sessions_history", "orchestration"],
    ["sessions_list", "orchestration"],
    ["session_status", "orchestration"],
    ["agents_list", "orchestration"],
    ["subagents", "orchestration"],
    ["update_plan", "orchestration"],
    // media — non-code artifacts (NEW BUCKET)
    ["image", "media"],
    ["image_generate", "media"],
    ["video_generate", "media"],
    ["music_generate", "media"],
    ["tts", "media"],
    ["pdf", "media"],
    ["canvas", "media"],
    ["nodes", "media"],
  ];

  it.each(cases)("getCategory(%s) → %s", (tool, expected) => {
    expect(getCategory(tool)).toBe(expected);
  });

  it("computeBreakdown returns 100% media for an all-media batch", () => {
    const b = computeBreakdown([
      { toolName: "image_generate" },
      { toolName: "tts" },
      { toolName: "video_generate" },
      { toolName: "canvas" },
    ]);
    expect(b.media).toBe(100);
    expect(b.exploring).toBe(0);
    expect(b.scripts).toBe(0);
    expect(b.orchestration).toBe(0);
  });

  it("computeBreakdown returns 100% orchestration for an all-session batch", () => {
    const b = computeBreakdown([
      { toolName: "sessions_send" },
      { toolName: "sessions_list" },
      { toolName: "subagents" },
      { toolName: "update_plan" },
    ]);
    expect(b.orchestration).toBe(100);
    expect(b.comms).toBe(0);
    expect(b.exploring).toBe(0);
  });

  it("computeBreakdown sums to 100 across an 8-bucket mix (rounding fixup is bucket-count-agnostic)", () => {
    // One entry per bucket — by-1 rounding artifacts must still fixup to 100.
    const b = computeBreakdown([
      { toolName: "read" },
      { toolName: "write" },
      { toolName: "exec", execCategory: "git-read" },
      { toolName: "exec", execCategory: "scripting" },
      { toolName: "fetch_url" },
      { toolName: "message" },
      { toolName: "sessions_send" },
      { toolName: "image_generate" },
    ]);
    const sum = Object.values(b).reduce((a, c) => a + c, 0);
    expect(sum).toBe(100);
    expect(b.orchestration).toBeGreaterThan(0);
    expect(b.media).toBeGreaterThan(0);
  });

  it("ALL_CATEGORIES includes orchestration and media in their canonical positions", () => {
    expect(ALL_CATEGORIES).toContain("orchestration");
    expect(ALL_CATEGORIES).toContain("media");
    // Lock the spec's display order: orchestration sits next to comms (peer
    // boundary-crossing buckets) and media stays last (creative output).
    expect(ALL_CATEGORIES).toEqual([
      "exploring",
      "changes",
      "git",
      "scripts",
      "web",
      "comms",
      "orchestration",
      "media",
    ]);
  });

  it("unknown future tools still fall through to scripts", () => {
    expect(getCategory("nonexistent_future_tool_2027")).toBe("scripts");
  });

  it("regression: sessions_spawn no longer routes to comms", () => {
    expect(getCategory("sessions_spawn")).not.toBe("comms");
    expect(getCategory("sessions_spawn")).toBe("orchestration");
  });
});

// describeAction is the *backend* description engine — it powers
// EntryResponse.description, which the Attention Inbox cards and the
// guardrail-creation closure render directly. Issue #44 surfaced that #42
// only extended the frontend description path (formatEventTarget /
// describeEntry), leaving describeAction's switch falling through to
// `default: return toolName` for the 20 new tools. These cases lock the
// per-tool output so the regression can't slide back in.
describe("describeAction — new tools (issue #44)", () => {
  // ── changes ──────────────────────────────────────────────
  it("describes apply_patch using a unified-diff path header", () => {
    expect(
      describeAction({
        toolName: "apply_patch",
        params: {
          patch: "--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1 +1 @@\n-old\n+new",
        },
      }),
    ).toBe("Patch: src/foo.ts");
  });

  it("describes apply_patch using the Codex *** Update File header", () => {
    expect(
      describeAction({
        toolName: "apply_patch",
        params: {
          patch: "*** Begin Patch\n*** Update File: src/bar.ts\n@@\n-old\n+new\n*** End Patch",
        },
      }),
    ).toBe("Patch: src/bar.ts");
  });

  it("falls back to a bare label when the patch carries no extractable path", () => {
    expect(describeAction({ toolName: "apply_patch", params: { patch: "garbage" } })).toBe(
      "Patch file",
    );
  });

  it("falls back to a bare label when no patch param is supplied", () => {
    expect(describeAction({ toolName: "apply_patch", params: {} })).toBe("Patch file");
  });

  it("describes gateway config.update with path", () => {
    expect(
      describeAction({
        toolName: "gateway",
        params: { action: "config.update", path: "rules.yaml" },
      }),
    ).toBe("Gateway update: rules.yaml");
  });

  it("describes gateway config.get with path", () => {
    expect(
      describeAction({
        toolName: "gateway",
        params: { action: "config.get", path: "rules.yaml" },
      }),
    ).toBe("Gateway query: rules.yaml");
  });

  it("describes gateway restart", () => {
    expect(describeAction({ toolName: "gateway", params: { action: "restart" } })).toBe(
      "Gateway restart",
    );
  });

  it("describes bare gateway with no action", () => {
    expect(describeAction({ toolName: "gateway", params: {} })).toBe("Gateway");
  });

  // ── web ──────────────────────────────────────────────────
  it("describes x_search with a query", () => {
    expect(describeAction({ toolName: "x_search", params: { query: "claude code" } })).toBe(
      'X search "claude code"',
    );
  });

  it("describes empty x_search", () => {
    expect(describeAction({ toolName: "x_search", params: {} })).toBe("X search");
  });

  // ── scripts ──────────────────────────────────────────────
  it("describes code_execution with code", () => {
    expect(describeAction({ toolName: "code_execution", params: { code: "print('hi')" } })).toBe(
      `Run code: "print('hi')"`,
    );
  });

  it("describes empty code_execution", () => {
    expect(describeAction({ toolName: "code_execution", params: {} })).toBe("Run code");
  });

  // ── media ────────────────────────────────────────────────
  it("describes image with both path and prompt", () => {
    expect(
      describeAction({
        toolName: "image",
        params: { path: "shot.png", prompt: "What's in this?" },
      }),
    ).toBe('Image: shot.png — "What\'s in this?"');
  });

  it("describes image with only path", () => {
    expect(describeAction({ toolName: "image", params: { path: "shot.png" } })).toBe(
      "Image: shot.png",
    );
  });

  it("describes pdf with file_path fallback", () => {
    expect(describeAction({ toolName: "pdf", params: { file_path: "/tmp/r.pdf" } })).toBe(
      "PDF: /tmp/r.pdf",
    );
  });

  it("describes image_generate with a prompt", () => {
    expect(
      describeAction({
        toolName: "image_generate",
        params: { prompt: "a dog wearing sunglasses" },
      }),
    ).toBe('Generate image: "a dog wearing sunglasses"');
  });

  it("describes image_generate with no prompt", () => {
    expect(describeAction({ toolName: "image_generate", params: {} })).toBe("Generate image");
  });

  it("describes video_generate with a prompt", () => {
    expect(
      describeAction({ toolName: "video_generate", params: { prompt: "sunset over the bay" } }),
    ).toBe('Generate video: "sunset over the bay"');
  });

  it("describes music_generate with a prompt", () => {
    expect(describeAction({ toolName: "music_generate", params: { prompt: "lofi beat" } })).toBe(
      'Generate music: "lofi beat"',
    );
  });

  it("describes tts with text", () => {
    expect(describeAction({ toolName: "tts", params: { text: "hello" } })).toBe('Speak: "hello"');
  });

  it("describes canvas navigate with url", () => {
    expect(
      describeAction({
        toolName: "canvas",
        params: { action: "navigate", url: "https://x.com" },
      }),
    ).toBe("Canvas navigate: https://x.com");
  });

  it("describes canvas snapshot with format", () => {
    expect(
      describeAction({ toolName: "canvas", params: { action: "snapshot", format: "png" } }),
    ).toBe("Canvas snapshot: png");
  });

  it("describes canvas snapshot with no format", () => {
    expect(describeAction({ toolName: "canvas", params: { action: "snapshot" } })).toBe(
      "Canvas snapshot",
    );
  });

  it("describes nodes system_run with both node and command", () => {
    expect(
      describeAction({
        toolName: "nodes",
        params: { action: "system_run", node: "raspi-1", command: "uptime" },
      }),
    ).toBe("Nodes raspi-1: uptime");
  });

  it("describes nodes camera_snap with a node", () => {
    expect(
      describeAction({
        toolName: "nodes",
        params: { action: "camera_snap", node: "raspi-2" },
      }),
    ).toBe("Nodes camera: raspi-2");
  });

  it("describes nodes screen_record with a node", () => {
    expect(
      describeAction({
        toolName: "nodes",
        params: { action: "screen_record", node: "mac-mini" },
      }),
    ).toBe("Nodes screen: mac-mini");
  });

  it("describes bare nodes with no action", () => {
    expect(describeAction({ toolName: "nodes", params: {} })).toBe("Nodes");
  });

  // ── orchestration ────────────────────────────────────────
  it("describes sessions_send with recipient and message", () => {
    expect(
      describeAction({
        toolName: "sessions_send",
        params: { sessionKey: "agent:beta:main", message: "ping" },
      }),
    ).toBe('Send to agent:beta:main: "ping"');
  });

  it("describes sessions_send with message only (no recipient)", () => {
    expect(describeAction({ toolName: "sessions_send", params: { message: "ping" } })).toBe(
      'Send: "ping"',
    );
  });

  it("describes empty sessions_send", () => {
    expect(describeAction({ toolName: "sessions_send", params: {} })).toBe("Send message");
  });

  it("describes sessions_yield with sessionKey", () => {
    expect(
      describeAction({
        toolName: "sessions_yield",
        params: { sessionKey: "agent:gamma:main" },
      }),
    ).toBe("Yield agent:gamma:main");
  });

  it("describes session_status with sessionKey", () => {
    expect(
      describeAction({
        toolName: "session_status",
        params: { sessionKey: "agent:x:main" },
      }),
    ).toBe("Status agent:x:main");
  });

  it("describes sessions_history with sessionKey", () => {
    expect(
      describeAction({
        toolName: "sessions_history",
        params: { sessionKey: "agent:x:main" },
      }),
    ).toBe("History agent:x:main");
  });

  it("describes sessions_list (empty params)", () => {
    expect(describeAction({ toolName: "sessions_list", params: {} })).toBe("List sessions");
  });

  it("describes agents_list", () => {
    expect(describeAction({ toolName: "agents_list", params: {} })).toBe("List agents");
  });

  it("describes subagents kill with target", () => {
    expect(
      describeAction({ toolName: "subagents", params: { action: "kill", target: "abc-123" } }),
    ).toBe("Kill subagent abc-123");
  });

  it("describes subagents steer with target", () => {
    expect(
      describeAction({ toolName: "subagents", params: { action: "steer", target: "abc-123" } }),
    ).toBe("Steer subagent abc-123");
  });

  it("describes subagents list (no target)", () => {
    expect(describeAction({ toolName: "subagents", params: { action: "list" } })).toBe(
      "List subagents",
    );
  });

  it("describes update_plan surfacing the in-progress step", () => {
    expect(
      describeAction({
        toolName: "update_plan",
        params: {
          plan: [
            { step: "scaffold", status: "completed" },
            { step: "wire api", status: "in_progress" },
            { step: "deploy", status: "pending" },
          ],
        },
      }),
    ).toBe('Plan: "wire api"');
  });

  it("describes update_plan with empty plan + explanation", () => {
    expect(
      describeAction({
        toolName: "update_plan",
        params: { plan: [], explanation: "thinking" },
      }),
    ).toBe("Plan: thinking");
  });

  it("describes update_plan with empty plan and no explanation", () => {
    expect(describeAction({ toolName: "update_plan", params: { plan: [] } })).toBe("Plan");
  });

  it("describes update_plan with non-array plan (defensive)", () => {
    expect(describeAction({ toolName: "update_plan", params: { plan: "not array" } })).toBe("Plan");
  });

  // Regression guard: every new tool must produce something other than the
  // bare tool name. Locks the spec invariant from the issue body.
  it("never returns the bare tool name for any of the 20 new tools (default fallthrough)", () => {
    const tools = [
      "apply_patch",
      "gateway",
      "x_search",
      "code_execution",
      "image",
      "image_generate",
      "video_generate",
      "music_generate",
      "tts",
      "pdf",
      "canvas",
      "nodes",
      "sessions_send",
      "sessions_yield",
      "sessions_history",
      "sessions_list",
      "session_status",
      "agents_list",
      "subagents",
      "update_plan",
    ];
    for (const tool of tools) {
      const out = describeAction({ toolName: tool, params: {} });
      expect(out, `${tool} must not fall through to the bare tool name`).not.toBe(tool);
    }
  });
});
